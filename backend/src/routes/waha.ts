import { Router } from 'express';
import { WahaSyncService } from '../services/wahaSyncService';
import { WhatsAppSessionService } from '../services/whatsappSessionService';
import { evolutionApiService } from '../services/evolutionApiService';
import { settingsService } from '../services/settingsService';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { Response } from 'express';
import { checkConnectionQuota } from '../middleware/quotaMiddleware';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const fetch = require('node-fetch');
const crypto = require('crypto');

// Função para gerar token aleatório para sessões Quepasa
function generateQuepasaToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

const wahaRequest = async (endpoint: string, options: any = {}) => {
  // Buscar configurações dinâmicas do banco usando o método específico
  const config = await settingsService.getWahaConfig();
  const WAHA_BASE_URL = config.host || process.env.WAHA_BASE_URL || process.env.DEFAULT_WAHA_HOST || '';
  const WAHA_API_KEY = config.apiKey || process.env.WAHA_API_KEY || process.env.DEFAULT_WAHA_API_KEY || '';

  console.log('🔍 WAHA Config Debug (routes):', {
    host: config.host,
    apiKey: config.apiKey ? `${config.apiKey.substring(0, 8)}...` : 'undefined',
    finalUrl: WAHA_BASE_URL,
    finalKey: WAHA_API_KEY ? `${WAHA_API_KEY.substring(0, 8)}...` : 'undefined'
  });

  if (!WAHA_BASE_URL || !WAHA_API_KEY) {
    throw new Error('Configurações WAHA não encontradas. Configure o Host e API Key nas configurações do sistema.');
  }

  const url = `${WAHA_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': WAHA_API_KEY,
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`WAHA API Error: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
};

const router = Router();

// Listar todas as sessões sincronizadas com WAHA API
router.get('/sessions', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const headerTenantId = req.header('X-Tenant-Id');
    console.log('📋 GET /sessions - user:', req.user?.email, 'role:', req.user?.role, 'tenantId:', req.tenantId, 'X-Tenant-Id header:', headerTenantId);

    // Sempre usar o tenantId do token (mesmo para SUPERADMIN quando tem empresa selecionada)
    const tenantId = req.tenantId;

    // Sempre sincronizar sessões WAHA para pegar status atualizado (WORKING, SCAN_QR_CODE, etc)
    try {
      await WahaSyncService.syncAllSessions();
    } catch (wahaError) {
      console.warn('⚠️ Erro ao sincronizar WAHA, mas continuando com dados do banco:', wahaError);
    }

    // Sincronizar sessões Quepasa
    try {
      console.log('🔄 Sincronizando status das sessões Quepasa...');
      const quepasaSessions = await WhatsAppSessionService.getAllSessions(tenantId);
      const quepasaConfig = await settingsService.getQuepasaConfig();

      console.log(`📊 Total de sessões: ${quepasaSessions.length}`);
      const quepasaSessionsFiltered = quepasaSessions.filter(s => s.provider === 'QUEPASA');
      console.log(`📊 Sessões Quepasa encontradas: ${quepasaSessionsFiltered.length}`, quepasaSessionsFiltered.map(s => s.name));
      console.log(`📊 Config Quepasa - URL: ${quepasaConfig.url ? 'configurada' : 'não configurada'}, Login: ${quepasaConfig.login}, Token: ${quepasaConfig.password ? 'configurado' : 'não configurado'}`);

      if (quepasaConfig.url && quepasaConfig.login) {
        for (const session of quepasaSessionsFiltered) {
          try {
            console.log(`🔍 Verificando status Quepasa para ${session.name}...`);

            // Usar APENAS o token da sessão (não usar token global)
            let sessionToken = (session as any).quepasaToken;

            // Se não tiver token E a sessão está WORKING, tentar buscar o token real da Quepasa
            // (sessões antigas conectadas antes da implementação do token)
            if (!sessionToken && (session as any).status === 'WORKING') {
              console.log(`🔍 Sessão ${session.name} está WORKING mas sem token salvo. Tentando re-descobrir token...`);

              try {
                // Listar TODOS os servidores do usuário para encontrar o token correto
                const listResponse = await fetch(`${quepasaConfig.url}/health`, {
                  headers: {
                    'Accept': 'application/json',
                    'X-QUEPASA-USER': quepasaConfig.login,
                    'X-QUEPASA-PASSWORD': quepasaConfig.password || ''
                  }
                });

                if (listResponse.ok) {
                  const listData = await listResponse.json();

                  if (listData.success && listData.items && Array.isArray(listData.items)) {
                    console.log(`📊 Encontrados ${listData.items.length} servidores Quepasa para re-descoberta`);

                    // Procurar servidor conectado (ready)
                    for (const server of listData.items) {
                      const statusLower = String(server.status || '').toLowerCase();
                      const isReady = statusLower === 'ready' || server.health === true;

                      if (server.token && isReady) {
                        sessionToken = server.token;
                        console.log(`✅ Token re-descoberto para ${session.name}: ${sessionToken.substring(0, 16)}...`);

                        // Salvar o token real encontrado
                        await WhatsAppSessionService.createOrUpdateSession({
                          name: session.name,
                          status: 'WORKING',
                          provider: 'QUEPASA',
                          tenantId: (session as any).tenantId,
                          displayName: (session as any).displayName,
                          quepasaToken: sessionToken,
                          me: {
                            id: server.wid || server.number || 'unknown',
                            pushName: 'Quepasa'
                          }
                        });
                        console.log(`💾 Token real salvo para ${session.name}`);
                        break;
                      }
                    }
                  }
                }
              } catch (rediscoverError) {
                console.warn(`⚠️ Erro ao tentar re-descobrir token:`, rediscoverError);
              }
            }

            // Se ainda não tiver token (sessão nova ou não conectada), gerar um novo
            if (!sessionToken) {
              sessionToken = generateQuepasaToken();
              console.log(`🔑 Gerando novo token para sessão ${session.name} no polling (sessão sem token): ${sessionToken.substring(0, 16)}...`);

              await WhatsAppSessionService.createOrUpdateSession({
                name: session.name,
                status: (session as any).status,
                provider: 'QUEPASA',
                tenantId: (session as any).tenantId,
                displayName: (session as any).displayName,
                quepasaToken: sessionToken
              });
              console.log(`💾 Token salvo para sessão ${session.name}`);
            }

            console.log(`🔑 Usando token da sessão para ${session.name}: ${sessionToken}`);

            // Primeiro tentar /health com o token da sessão
            const statusResponse = await fetch(`${quepasaConfig.url}/health`, {
              headers: {
                'Accept': 'application/json',
                'X-QUEPASA-TOKEN': sessionToken
              }
            });

            console.log(`📡 Response status: ${statusResponse.status} ${statusResponse.statusText}`);

            // Erro 400 = token não encontrado. A Quepasa gera um token próprio ao conectar!
            // Precisamos listar TODOS os servidores do usuário e encontrar o nosso pelo wid/number
            if (statusResponse.status === 400) {
              console.log(`🔍 Token ${sessionToken.substring(0, 16)}... não encontrado na Quepasa.`);
              console.log(`🔄 Listando todos os servidores do usuário para verificar se há conexão...`);

              try {
                // Listar TODOS os servidores do usuário usando autenticação por usuário/senha
                const listResponse = await fetch(`${quepasaConfig.url}/health`, {
                  headers: {
                    'Accept': 'application/json',
                    'X-QUEPASA-USER': quepasaConfig.login,
                    'X-QUEPASA-PASSWORD': quepasaConfig.password || ''
                  }
                });

                if (listResponse.ok) {
                  const listData = await listResponse.json();
                  console.log(`📋 Lista de servidores Quepasa:`, JSON.stringify(listData, null, 2));

                  if (listData.success && listData.items && Array.isArray(listData.items)) {
                    console.log(`📊 Encontrados ${listData.items.length} servidores Quepasa`);

                    // Listar TODOS os servidores para debug
                    for (const server of listData.items) {
                      console.log(`📋 Servidor Quepasa: ${server.number || server.wid} - Status: ${server.status} - Health: ${server.health} - Token: ${server.token ? server.token.substring(0, 16) + '...' : 'sem token'}`);
                    }

                    // Contar quantos servidores estão ready
                    let readyServers = 0;
                    for (const server of listData.items) {
                      const statusLower = String(server.status || '').toLowerCase();
                      const isReady = statusLower === 'ready' || server.health === true;
                      if (isReady) readyServers++;
                    }

                    console.log(`📊 Servidores ready encontrados: ${readyServers}`);

                    // Se há exatamente 1 servidor ready, significa que o QR foi escaneado!
                    // Associar esse servidor à sessão atual
                    if (readyServers === 1) {
                      console.log(`✅ Detectado 1 servidor ready! QR foi escaneado. Associando à sessão ${session.name}`);

                      for (const server of listData.items) {
                        const statusLower = String(server.status || '').toLowerCase();
                        const isReady = statusLower === 'ready' || server.health === true;

                        if (server.token && isReady) {
                          // Salvar o token real da Quepasa (o token que a Quepasa gerou)
                          const quepasaRealToken = server.token;
                          console.log(`🔑 Token real da Quepasa encontrado: ${quepasaRealToken.substring(0, 16)}...`);

                          await WhatsAppSessionService.createOrUpdateSession({
                            name: session.name,
                            status: 'WORKING',
                            provider: 'QUEPASA',
                            tenantId: (session as any).tenantId,
                            displayName: (session as any).displayName,
                            quepasaToken: quepasaRealToken, // Salvar o token REAL da Quepasa
                            me: {
                              id: server.wid || server.number || 'unknown',
                              pushName: 'Quepasa'
                            }
                          });
                          console.log(`💾 Sessão ${session.name} agora está WORKING com token real da Quepasa`);
                          break;
                        }
                      }
                    } else if (readyServers === 0) {
                      console.log(`⏳ Nenhum servidor ready encontrado, sessão ${session.name} aguardando conexão`);
                    } else {
                      console.log(`⚠️ Múltiplos servidores ready encontrados (${readyServers}), não é possível associar automaticamente`);
                    }
                  }
                }

                continue;
              } catch (listError) {
                console.warn(`⚠️ Erro ao listar servidores Quepasa:`, listError);
                continue;
              }
            }

            if (statusResponse.ok) {
              const statusData = await statusResponse.json();
              console.log(`📱 Status Quepasa completo (JSON):`, JSON.stringify(statusData, null, 2));

              // Endpoint /health retorna: { success: true/false, status: "server status is ready"/"server status is disconnected"/etc }
              let mappedStatus: 'WORKING' | 'SCAN_QR_CODE' | 'STOPPED' | 'FAILED' = 'STOPPED';
              const statusLower = String(statusData.status).toLowerCase();

              console.log(`🔍 Debug - success: ${statusData.success}, status original: "${statusData.status}", statusLower: "${statusLower}"`);

              // /health retorna "server status is ready" quando conectado
              if (statusData.success === true && statusLower.includes('ready')) {
                mappedStatus = 'WORKING';
                console.log('✅ Mapeado para WORKING');
              } else if (statusLower.includes('starting') || statusLower.includes('qrcode')) {
                mappedStatus = 'SCAN_QR_CODE';
                console.log('⏳ Mapeado para SCAN_QR_CODE');
              } else if (statusLower.includes('disconnected') || statusLower.includes('stopped')) {
                mappedStatus = 'STOPPED';
                console.log('⏹️ Mapeado para STOPPED');
              } else {
                mappedStatus = 'FAILED';
                console.log('❌ Mapeado para FAILED');
              }

              console.log(`📱 Status mapeado para ${session.name}: ${mappedStatus}`);

              // Extrair informações do número conectado se disponível
              let meData: any = undefined;
              if (statusData.number || statusData.wid || statusData.id) {
                const phoneNumber = statusData.number || statusData.wid || statusData.id;
                meData = {
                  id: phoneNumber,
                  pushName: statusData.pushName || statusData.name || 'Quepasa',
                };
                console.log(`📞 Número Quepasa detectado:`, meData);
              }

              // Atualizar status no banco (manter o token que já foi salvo/descoberto)
              await WhatsAppSessionService.createOrUpdateSession({
                name: session.name,
                status: mappedStatus,
                provider: 'QUEPASA',
                tenantId: session.tenantId || undefined,
                quepasaToken: sessionToken, // IMPORTANTE: preservar o token
                me: meData
              });
            }
          } catch (quepasaError) {
            console.warn(`⚠️ Erro ao sincronizar status Quepasa para ${session.name}:`, quepasaError);
          }
        }
      }
    } catch (quepasaError) {
      console.warn('⚠️ Erro ao sincronizar Quepasa, mas continuando com dados do banco:', quepasaError);
    }

    // Sincronizar TODAS as instâncias Evolution que existem na API
    try {
      console.log('🔄 Sincronizando todas as instâncias Evolution da API...');
      const allEvolutionInstances = await evolutionApiService.listInstances();
      console.log(`📡 Evolution API retornou ${allEvolutionInstances.length} instâncias`);

      for (const instance of allEvolutionInstances) {
        try {
          // Evolution API retorna 'name' ou 'instanceName' dependendo do endpoint
          const instanceName = (instance as any).name || instance.instanceName;
          if (!instanceName) {
            console.warn('⚠️ Instância sem nome, pulando:', instance);
            continue;
          }

          // Filtrar apenas instâncias criadas pelo nosso sistema (padrão: nome_tenantPrefix)
          // Instâncias do nosso sistema têm underscore e seguem o padrão displayName_primeiros8CharsTenantId
          if (!instanceName.includes('_') || instanceName.split('_').length !== 2) {
            console.log(`⏭️ Pulando instância externa (não criada pelo sistema): ${instanceName}`);
            continue;
          }

          console.log(`📝 Processando instância Evolution: ${instanceName}`);

          // Buscar sessão existente no banco
          let existingSession = null;
          try {
            existingSession = await WhatsAppSessionService.getSession(instanceName);
          } catch (error) {
            // Sessão não existe no banco, será criada
          }

          // Obter status atualizado
          const status = await evolutionApiService.getInstanceStatus(instanceName);
          console.log(`🔍 Status Evolution para ${instanceName}:`, status);

          // Obter informações detalhadas da instância
          const instanceInfo = await evolutionApiService.getInstanceInfo(instanceName);
          console.log(`📋 Info Evolution para ${instanceName}:`, JSON.stringify(instanceInfo, null, 2));

          // Montar dados do 'me' quando conectado
          let meData = undefined;
          const evolutionData = instanceInfo as any;
          if (status === 'WORKING' && (evolutionData.ownerJid || evolutionData.owner)) {
            const jid = evolutionData.ownerJid || evolutionData.owner;
            meData = {
              id: jid,
              pushName: evolutionData.profileName || instanceInfo.profileName || 'Usuário WhatsApp',
              jid: jid
            };
            console.log(`👤 Dados 'me' para ${instanceName}:`, meData);
          }

          // Criar ou atualizar a sessão no banco
          if (status && ['WORKING', 'SCAN_QR_CODE', 'STOPPED', 'FAILED'].includes(status)) {
            console.log(`💾 Salvando sessão Evolution ${instanceName} com status ${status}${meData ? ' e dados me' : ''}`);
            await WhatsAppSessionService.createOrUpdateSession({
              name: instanceName,
              displayName: existingSession?.displayName || instanceName,
              status: status as 'WORKING' | 'SCAN_QR_CODE' | 'STOPPED' | 'FAILED',
              provider: 'EVOLUTION',
              me: meData,
              qr: existingSession?.qr || undefined,
              qrExpiresAt: existingSession?.qrExpiresAt || undefined,
              tenantId: existingSession?.tenantId || tenantId
            });
            console.log(`✅ Instância Evolution "${instanceName}" sincronizada com status ${status}`);
          }
        } catch (instanceError) {
          console.warn(`⚠️ Erro ao sincronizar instância Evolution:`, instanceError);
        }
      }
    } catch (evolutionError) {
      console.warn('⚠️ Erro ao sincronizar Evolution, mas continuando com dados do banco:', evolutionError);
    }

    // Retornar todas as sessões atualizadas do banco
    const updatedSessions = await WhatsAppSessionService.getAllSessions(tenantId);
    res.json(updatedSessions);
  } catch (error) {
    console.error('Erro ao listar sessões:', error);
    res.status(500).json({ error: 'Erro ao listar sessões WhatsApp' });
  }
});

// Obter informações de uma sessão específica
router.get('/sessions/:sessionName', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionName } = req.params;
    console.log('🔍 GET /sessions/:sessionName - sessionName:', sessionName, 'user:', req.user?.email, 'tenantId:', req.tenantId);

    // SUPERADMIN pode ver qualquer sessão, outros usuários só do seu tenant
    const tenantId = req.user?.role === 'SUPERADMIN' ? undefined : req.tenantId;

    // Primeiro tentar buscar a sessão no banco com tenant isolation
    try {
      const session = await WhatsAppSessionService.getSession(sessionName, tenantId);
      console.log('✅ Sessão encontrada no banco:', session.name);
      return res.json(session);
    } catch (dbError) {
      console.log('⚠️ Sessão não encontrada no banco, tentando sincronizar com WAHA...');
    }

    // Se não encontrar no banco, tentar sincronizar com WAHA
    const session = await WahaSyncService.syncSession(sessionName);
    res.json(session);
  } catch (error) {
    console.error('Erro ao obter sessão:', error);
    res.status(500).json({ error: 'Erro ao obter informações da sessão' });
  }
});

// Criar nova sessão
router.post('/sessions', authMiddleware, checkConnectionQuota, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, provider = 'WAHA' } = req.body;
    console.log('➕ POST /sessions - name:', name, 'provider:', provider, 'user:', req.user?.email, 'tenantId:', req.tenantId);

    if (!name) {
      return res.status(400).json({ error: 'Nome da sessão é obrigatório' });
    }

    if (!['WAHA', 'EVOLUTION', 'QUEPASA'].includes(provider)) {
      return res.status(400).json({ error: 'Provedor deve ser WAHA, EVOLUTION ou QUEPASA' });
    }

    // Usar tenantId do usuário autenticado (SUPERADMIN pode especificar tenant no body se necessário)
    const tenantId = req.user?.role === 'SUPERADMIN' ? req.body.tenantId || req.tenantId : req.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: 'TenantId é obrigatório' });
    }

    // Gerar nome real: displayName_primeiros8CharsTenantId
    // Ex: vendas_c52982e8
    const displayName = name.trim();
    const tenantPrefix = tenantId.substring(0, 8);
    const realName = `${displayName}_${tenantPrefix}`;

    console.log('📝 Criando sessão - displayName:', displayName, 'realName:', realName);

    // Verificar se já existe uma sessão com este realName
    const existingSession = await prisma.whatsAppSession.findUnique({
      where: { name: realName }
    });

    if (existingSession) {
      console.log('⚠️ Sessão já existe:', realName);
      return res.status(409).json({ error: 'Já existe uma conexão com este nome' });
    }

    let result;

    if (provider === 'EVOLUTION') {
      const { evolutionApiService } = await import('../services/evolutionApiService');
      result = await evolutionApiService.createInstance(realName);

      // Extrair QR code da resposta da criação (se disponível)
      let qrCode: string | undefined;
      let qrExpiresAt: Date | undefined;

      if (result.qrcode?.base64) {
        // QR code veio na resposta
        qrCode = result.qrcode.base64.startsWith('data:image/')
          ? result.qrcode.base64
          : `data:image/png;base64,${result.qrcode.base64}`;
        qrExpiresAt = new Date(Date.now() + 300000); // 5 minutos
        console.log(`✅ QR Code Evolution recebido na criação para ${realName}`);
      }

      // Salvar no banco com provider Evolution, tenantId, displayName e QR code (se disponível)
      await WhatsAppSessionService.createOrUpdateSession({
        name: realName,
        displayName,
        status: 'SCAN_QR_CODE',
        provider: 'EVOLUTION',
        tenantId,
        qr: qrCode,
        qrExpiresAt: qrExpiresAt
      });
    } else if (provider === 'QUEPASA') {
      // Quepasa - criar sessão e gerar token único
      // O QR code será gerado quando o usuário clicar para conectar
      const quepasaToken = generateQuepasaToken();
      console.log(`🔑 Token único gerado para sessão QuePasa ${realName}: ${quepasaToken.substring(0, 16)}...`);

      result = { name: realName, status: 'STOPPED', provider: 'QUEPASA', token: quepasaToken };

      await WhatsAppSessionService.createOrUpdateSession({
        name: realName,
        displayName,
        status: 'STOPPED',
        provider: 'QUEPASA',
        tenantId,
        quepasaToken
      });
    } else {
      // WAHA (comportamento original)
      result = await WahaSyncService.createSession(realName);

      // Para WAHA também salvar com tenantId e displayName
      await WhatsAppSessionService.createOrUpdateSession({
        name: realName,
        displayName,
        status: 'SCAN_QR_CODE',
        provider: 'WAHA',
        tenantId
      });
    }

    console.log('✅ Sessão criada:', realName, '(display:', displayName, ') tenant:', tenantId);

    res.json(result);
  } catch (error) {
    console.error('Erro ao criar sessão:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao criar sessão WhatsApp' });
  }
});

// Iniciar sessão
router.post('/sessions/:sessionName/start', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionName } = req.params;
    console.log('▶️ POST /sessions/:sessionName/start - sessionName:', sessionName, 'user:', req.user?.email, 'tenantId:', req.tenantId);

    // SUPERADMIN pode iniciar qualquer sessão, outros usuários só do seu tenant
    const tenantId = req.user?.role === 'SUPERADMIN' ? undefined : req.tenantId;

    // Verificar o provedor da sessão
    let sessionProvider = 'WAHA'; // Default para WAHA (compatibilidade)
    let sessionData: any;
    try {
      sessionData = await WhatsAppSessionService.getSession(sessionName, tenantId);
      sessionProvider = sessionData.provider || 'WAHA';
    } catch (error) {
      console.error('❌ Sessão não encontrada ou não pertence ao tenant:', error);
      return res.status(404).json({ error: 'Sessão não encontrada' });
    }

    console.log(`▶️ Iniciando sessão ${sessionName} via ${sessionProvider}`);

    let result;
    if (sessionProvider === 'EVOLUTION') {
      // Usar Evolution API - conectar e obter QR Code
      try {
        console.log(`🔄 Conectando instância Evolution ${sessionName}...`);
        result = await evolutionApiService.getQRCode(sessionName);

        // Se conseguiu obter QR, salvar no banco
        if (result) {
          const qrExpiresAt = new Date(Date.now() + 300000); // 5 minutos

          await WhatsAppSessionService.createOrUpdateSession({
            name: sessionName,
            status: 'SCAN_QR_CODE',
            provider: 'EVOLUTION',
            tenantId: sessionData.tenantId,
            qr: result,
            qrExpiresAt: qrExpiresAt
          });

          console.log(`✅ Sessão Evolution ${sessionName} iniciada com QR Code salvo`);
        }

        // Retornar o QR code para o frontend
        result = { qr: result, status: 'SCAN_QR_CODE' };
      } catch (error: any) {
        console.error(`❌ Erro ao conectar instância Evolution ${sessionName}:`, error.message);
        throw new Error(`Erro ao iniciar sessão WhatsApp: ${error.message}`);
      }
    } else if (sessionProvider === 'QUEPASA') {
      // Usar Quepasa API - gerar QR Code
      try {
        console.log(`🔄 Conectando instância Quepasa ${sessionName}...`);

        // Buscar configurações do Quepasa
        const quepasaConfig = await settingsService.getQuepasaConfig();

        if (!quepasaConfig.url || !quepasaConfig.login) {
          throw new Error('Configure as credenciais Quepasa nas configurações do sistema');
        }

        // Usar APENAS o token da sessão (não usar token global)
        let sessionToken = sessionData.quepasaToken;

        // Se não tiver token, gerar e salvar um novo (para sessões criadas antes da implementação)
        if (!sessionToken) {
          sessionToken = generateQuepasaToken();
          console.log(`🔑 Gerando novo token para sessão ${sessionName} (sessão sem token): ${sessionToken.substring(0, 16)}...`);

          await WhatsAppSessionService.createOrUpdateSession({
            name: sessionName,
            status: sessionData.status,
            provider: 'QUEPASA',
            tenantId: sessionData.tenantId,
            quepasaToken: sessionToken
          });
          console.log(`💾 Token salvo para sessão ${sessionName}`);
        }

        console.log(`🔑 Usando token da sessão para ${sessionName}`);

        // Fazer requisição para gerar QR Code
        const qrResponse = await fetch(`${quepasaConfig.url}/scan`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'X-QUEPASA-USER': quepasaConfig.login,
            'X-QUEPASA-TOKEN': sessionToken
          }
        });

        if (!qrResponse.ok) {
          throw new Error(`Erro ao gerar QR Code Quepasa: ${qrResponse.status} ${qrResponse.statusText}`);
        }

        // Converter resposta para base64
        const imageBuffer = await qrResponse.arrayBuffer();
        const base64Image = Buffer.from(imageBuffer).toString('base64');
        const qrBase64 = `data:image/png;base64,${base64Image}`;

        const qrExpiresAt = new Date(Date.now() + 300000); // 5 minutos

        // Salvar QR no banco
        await WhatsAppSessionService.createOrUpdateSession({
          name: sessionName,
          status: 'SCAN_QR_CODE',
          provider: 'QUEPASA',
          tenantId: sessionData.tenantId,
          qr: qrBase64,
          qrExpiresAt: qrExpiresAt
        });

        console.log(`✅ Sessão Quepasa ${sessionName} iniciada com QR Code salvo`);

        result = { qr: qrBase64, status: 'SCAN_QR_CODE' };
      } catch (error: any) {
        console.error(`❌ Erro ao conectar instância Quepasa ${sessionName}:`, error.message);
        throw new Error(`Erro ao iniciar sessão Quepasa: ${error.message}`);
      }
    } else {
      // Usar WAHA com chamada direta
      result = await wahaRequest(`/api/sessions/${sessionName}/start`, {
        method: 'POST'
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Erro ao iniciar sessão:', error);
    res.status(500).json({ error: 'Erro ao iniciar sessão WhatsApp' });
  }
});

// Parar sessão
router.post('/sessions/:sessionName/stop', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionName } = req.params;
    console.log('⏹️ POST /sessions/:sessionName/stop - sessionName:', sessionName, 'user:', req.user?.email, 'tenantId:', req.tenantId);

    // SUPERADMIN pode parar qualquer sessão, outros usuários só do seu tenant
    const tenantId = req.user?.role === 'SUPERADMIN' ? undefined : req.tenantId;

    // Verificar o provedor da sessão
    let sessionProvider = 'WAHA';
    let sessionData: any;
    try {
      sessionData = await WhatsAppSessionService.getSession(sessionName, tenantId);
      sessionProvider = sessionData.provider || 'WAHA';
    } catch (error) {
      console.error('❌ Sessão não encontrada ou não pertence ao tenant:', error);
      return res.status(404).json({ error: 'Sessão não encontrada' });
    }

    console.log(`⏹️ Parando sessão ${sessionName} via ${sessionProvider}`);

    let result;
    if (sessionProvider === 'EVOLUTION') {
      // Para Evolution API, não há stop específico, apenas deletar
      result = { message: 'Sessão Evolution parada (conceitual)' };
      await WhatsAppSessionService.createOrUpdateSession({
        name: sessionName,
        status: 'STOPPED',
        provider: 'EVOLUTION',
        tenantId: sessionData.tenantId
      });
    } else {
      result = await WahaSyncService.stopSession(sessionName);
    }

    res.json(result);
  } catch (error) {
    console.error('Erro ao parar sessão:', error);
    res.status(500).json({ error: 'Erro ao parar sessão WhatsApp' });
  }
});

// Reiniciar sessão
router.post('/sessions/:sessionName/restart', async (req, res) => {
  try {
    const { sessionName } = req.params;

    // Verificar o provedor da sessão
    let sessionProvider = 'WAHA';
    try {
      const savedSession = await WhatsAppSessionService.getSession(sessionName);
      sessionProvider = (savedSession as any).provider || 'WAHA';
    } catch (error) {
      // Se sessão não existe no banco, assumir WAHA
    }

    console.log(`🔄 Reiniciando sessão ${sessionName} via ${sessionProvider}`);

    let result;
    if (sessionProvider === 'EVOLUTION') {
      result = await evolutionApiService.restartInstance(sessionName);
      await WhatsAppSessionService.createOrUpdateSession({
        name: sessionName,
        status: 'SCAN_QR_CODE',
        provider: 'EVOLUTION'
      });
    } else {
      result = await WahaSyncService.restartSession(sessionName);
    }

    res.json(result);
  } catch (error) {
    console.error('Erro ao reiniciar sessão:', error);
    res.status(500).json({ error: 'Erro ao reiniciar sessão WhatsApp' });
  }
});

// Deletar sessão
router.delete('/sessions/:sessionName', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionName } = req.params;
    console.log('🗑️ DELETE /sessions/:sessionName - sessionName:', sessionName, 'user:', req.user?.email, 'tenantId:', req.tenantId);

    // SUPERADMIN pode deletar qualquer sessão, outros usuários só do seu tenant
    const tenantId = req.user?.role === 'SUPERADMIN' ? undefined : req.tenantId;

    // Verificar o provedor da sessão
    let sessionProvider: 'WAHA' | 'EVOLUTION' | 'QUEPASA' = 'WAHA';
    try {
      const savedSession = await WhatsAppSessionService.getSession(sessionName, tenantId);
      sessionProvider = (savedSession.provider as 'WAHA' | 'EVOLUTION' | 'QUEPASA') || 'WAHA';
    } catch (error) {
      console.error('❌ Sessão não encontrada ou não pertence ao tenant:', error);
      return res.status(404).json({ error: 'Sessão não encontrada' });
    }

    console.log(`🗑️ Deletando sessão ${sessionName} via ${sessionProvider}`);

    // Deletar da API correspondente
    if (sessionProvider === 'EVOLUTION') {
      try {
        await evolutionApiService.deleteInstance(sessionName);
        console.log(`✅ Sessão ${sessionName} deletada da Evolution API`);
      } catch (error) {
        console.warn(`⚠️ Erro ao deletar ${sessionName} da Evolution API:`, error);
      }
      // Para Evolution, deletar manualmente do banco também
      try {
        await WhatsAppSessionService.deleteSession(sessionName, tenantId);
        console.log(`✅ Sessão ${sessionName} removida do banco de dados`);
      } catch (error) {
        console.warn(`⚠️ Erro ao deletar ${sessionName} do banco:`, error);
      }
    } else if (sessionProvider === 'QUEPASA') {
      try {
        // Buscar configurações do Quepasa e dados da sessão
        const quepasaConfig = await settingsService.getQuepasaConfig();
        const savedSession = await WhatsAppSessionService.getSession(sessionName, tenantId);

        if (quepasaConfig.url && quepasaConfig.login) {
          // Usar o token da sessão salvo no banco
          let sessionToken = (savedSession as any).quepasaToken;

          console.log(`🗑️ Deletando servidor Quepasa - Token: ${sessionToken ? sessionToken.substring(0, 16) + '...' : 'SEM TOKEN'}`);

          if (!sessionToken) {
            console.warn(`⚠️ Sessão ${sessionName} não tem token Quepasa salvo, pulando deleção na API`);
          } else {
            console.log(`🗑️ Deletando servidor Quepasa via API DELETE /info...`);

            // Deletar o servidor no Quepasa usando DELETE /info
            const deleteResponse = await fetch(`${quepasaConfig.url}/info`, {
              method: 'DELETE',
              headers: {
                'Accept': 'application/json',
                'X-QUEPASA-TOKEN': sessionToken
              }
            });

            console.log(`📡 Delete response status: ${deleteResponse.status} ${deleteResponse.statusText}`);

            if (deleteResponse.ok) {
              try {
                const deleteData = await deleteResponse.json();
                console.log(`✅ Servidor Quepasa deletado com sucesso:`, JSON.stringify(deleteData, null, 2));
              } catch (jsonError) {
                // Algumas APIs retornam 200 sem body
                console.log(`✅ Servidor Quepasa deletado (resposta sem JSON)`);
              }
            } else {
              const errorText = await deleteResponse.text();
              console.warn(`⚠️ Erro ao deletar do Quepasa: ${deleteResponse.status} - ${errorText}`);
            }
          }
        }
      } catch (quepasaError) {
        console.warn(`⚠️ Erro ao deletar ${sessionName} do Quepasa:`, quepasaError);
      }

      // Deletar do banco de dados
      try {
        await WhatsAppSessionService.deleteSession(sessionName, tenantId);
        console.log(`✅ Sessão ${sessionName} removida do banco de dados`);
      } catch (error) {
        console.warn(`⚠️ Erro ao deletar ${sessionName} do banco:`, error);
      }
    } else {
      // Deletar via WAHA (já remove do banco também)
      await WahaSyncService.deleteSession(sessionName);
    }

    res.json({ success: true, message: 'Sessão removida com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar sessão:', error);
    res.status(500).json({ error: 'Erro ao remover sessão WhatsApp' });
  }
});

// Obter QR Code da sessão
router.get('/sessions/:sessionName/auth/qr', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionName } = req.params;
    console.log(`🔍 GET /sessions/:sessionName/auth/qr - sessionName: ${sessionName}, user: ${req.user?.email}, tenantId: ${req.tenantId}`);

    // SUPERADMIN pode ver QR de qualquer sessão, outros usuários só do seu tenant
    const tenantId = req.user?.role === 'SUPERADMIN' ? undefined : req.tenantId;

    // Primeiro, verificar se existe QR salvo no banco com tenant isolation
    try {
      const savedSession = await WhatsAppSessionService.getSession(sessionName, tenantId);

      if (savedSession.qr && savedSession.qrExpiresAt && savedSession.qrExpiresAt > new Date()) {
        console.log(`💾 Retornando QR salvo do banco para ${sessionName}`);
        return res.json({
          qr: savedSession.qr,
          expiresAt: savedSession.qrExpiresAt,
          status: savedSession.status,
          message: "QR code retornado do banco de dados"
        });
      }
    } catch (dbError) {
      console.log(`📋 Sessão ${sessionName} não encontrada no banco ou não pertence ao tenant, verificando WAHA API...`);
      return res.status(404).json({ error: 'Sessão não encontrada' });
    }

    // Verificar o provedor da sessão para rotear corretamente
    let sessionProvider: 'WAHA' | 'EVOLUTION' | 'QUEPASA' = 'WAHA'; // Default para WAHA (compatibilidade)
    let sessionData: any;
    try {
      sessionData = await WhatsAppSessionService.getSession(sessionName, tenantId);
      console.log(`🔍 Sessão ${sessionName} encontrada no banco:`, {
        provider: sessionData.provider,
        status: sessionData.status
      });
      sessionProvider = (sessionData.provider as 'WAHA' | 'EVOLUTION' | 'QUEPASA') || 'WAHA';
    } catch (error) {
      console.log(`⚠️ Sessão ${sessionName} não encontrada no banco ou não pertence ao tenant, assumindo WAHA`);
      return res.status(404).json({ error: 'Sessão não encontrada' });
    }

    console.log(`🔍 Processando QR para sessão ${sessionName} via ${sessionProvider}`);

    // Se for Evolution API, usar o serviço específico
    if (sessionProvider === 'EVOLUTION') {
      try {
        const qrCodeData = await evolutionApiService.getQRCode(sessionName);
        const expiresAt = new Date(Date.now() + 300000); // 5 minutos

        // Salvar o QR code no banco de dados
        await WhatsAppSessionService.createOrUpdateSession({
          name: sessionName,
          status: 'SCAN_QR_CODE',
          provider: 'EVOLUTION',
          qr: qrCodeData,
          qrExpiresAt: expiresAt,
          tenantId: sessionData.tenantId
        });

        console.log(`💾 QR code Evolution salvo no banco para sessão ${sessionName}`);

        return res.json({
          qr: qrCodeData,
          expiresAt: expiresAt,
          status: 'SCAN_QR_CODE',
          provider: 'EVOLUTION',
          message: "QR code gerado via Evolution API"
        });
      } catch (evolutionError: any) {
        console.error(`❌ Erro ao obter QR da Evolution API:`, evolutionError);
        return res.status(500).json({
          error: 'Erro ao obter QR Code da Evolution API',
          details: evolutionError.message
        });
      }
    } else if (sessionProvider === 'QUEPASA') {
      try {
        // Buscar configurações do Quepasa
        const quepasaConfig = await settingsService.getQuepasaConfig();

        if (!quepasaConfig.url || !quepasaConfig.login) {
          throw new Error('Configure as credenciais Quepasa nas configurações do sistema');
        }

        // Usar APENAS o token da sessão (não usar token global)
        let sessionToken = sessionData.quepasaToken;

        // Se não tiver token, gerar e salvar um novo (para sessões criadas antes da implementação)
        if (!sessionToken) {
          sessionToken = generateQuepasaToken();
          console.log(`🔑 Gerando novo token para sessão ${sessionName} (sessão sem token): ${sessionToken.substring(0, 16)}...`);

          await WhatsAppSessionService.createOrUpdateSession({
            name: sessionName,
            status: sessionData.status,
            provider: 'QUEPASA',
            tenantId: sessionData.tenantId,
            quepasaToken: sessionToken
          });
          console.log(`💾 Token salvo para sessão ${sessionName}`);
        }

        console.log(`🔑 Usando token da sessão para ${sessionName}`);

        // Fazer requisição para gerar QR Code
        const qrResponse = await fetch(`${quepasaConfig.url}/scan`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'X-QUEPASA-USER': quepasaConfig.login,
            'X-QUEPASA-TOKEN': sessionToken
          }
        });

        if (!qrResponse.ok) {
          throw new Error(`Erro ao gerar QR Code Quepasa: ${qrResponse.status} ${qrResponse.statusText}`);
        }

        // Converter resposta para base64
        const imageBuffer = await qrResponse.arrayBuffer();
        const base64Image = Buffer.from(imageBuffer).toString('base64');
        const qrBase64 = `data:image/png;base64,${base64Image}`;

        const expiresAt = new Date(Date.now() + 300000); // 5 minutos

        // Salvar o QR code no banco de dados
        await WhatsAppSessionService.createOrUpdateSession({
          name: sessionName,
          status: 'SCAN_QR_CODE',
          provider: 'QUEPASA',
          qr: qrBase64,
          qrExpiresAt: expiresAt,
          tenantId: sessionData.tenantId
        });

        console.log(`💾 QR code Quepasa salvo no banco para sessão ${sessionName}`);

        return res.json({
          qr: qrBase64,
          expiresAt: expiresAt,
          status: 'SCAN_QR_CODE',
          provider: 'QUEPASA',
          message: "QR code gerado via Quepasa API"
        });
      } catch (quepasaError: any) {
        console.error(`❌ Erro ao obter QR da Quepasa API:`, quepasaError);
        return res.status(500).json({
          error: 'Erro ao obter QR Code da Quepasa API',
          details: quepasaError.message
        });
      }
    } else {
      // Para WAHA, manter lógica original
    let sessionStatus;
    try {
      sessionStatus = await wahaRequest(`/api/sessions/${sessionName}`);
      console.log(`🔍 Status da sessão ${sessionName}:`, sessionStatus.status);
    } catch (wahaError: any) {
      console.error(`❌ Erro ao consultar status da sessão ${sessionName} na WAHA:`, wahaError.message);
      // Se não conseguir acessar WAHA, mas temos a sessão no banco com status SCAN_QR_CODE,
      // vamos tentar gerar o QR usando apenas a URL
      if (sessionData.status === 'SCAN_QR_CODE') {
        console.log(`🔄 Tentando gerar QR com base no banco (status: ${sessionData.status})`);
        sessionStatus = { status: 'SCAN_QR_CODE' };
      } else {
        return res.status(400).json({
          error: 'Não foi possível acessar a API WAHA para verificar o status da sessão',
          details: wahaError.message
        });
      }
    }

    // Priorizar status do banco se for SCAN_QR_CODE, senão usar status da WAHA
    const effectiveStatus = sessionData.status === 'SCAN_QR_CODE' ? 'SCAN_QR_CODE' : sessionStatus.status;
    console.log(`🔄 Status efetivo para ${sessionName}: ${effectiveStatus} (banco: ${sessionData.status}, WAHA: ${sessionStatus.status})`);

    if (effectiveStatus === 'SCAN_QR_CODE') {
      // Sessão está aguardando QR code - buscar QR da WAHA API
      console.log(`📱 Buscando QR code da WAHA API para sessão ${sessionName}`);

      try {
        // Buscar configurações WAHA
        const config = await settingsService.getWahaConfig();
        const WAHA_BASE_URL = config.host || process.env.WAHA_BASE_URL || process.env.DEFAULT_WAHA_HOST || '';
        const WAHA_API_KEY = config.apiKey || process.env.WAHA_API_KEY || process.env.DEFAULT_WAHA_API_KEY || '';

        // Buscar QR como imagem e converter para base64
        const qrImageUrl = `${WAHA_BASE_URL}/api/${sessionName}/auth/qr?format=image`;
        console.log(`📱 Buscando QR image da WAHA: ${qrImageUrl}`);

        const response = await fetch(qrImageUrl, {
          headers: {
            'X-API-KEY': WAHA_API_KEY,
            'Accept': 'image/png'
          }
        });

        if (!response.ok) {
          throw new Error(`Erro ao buscar QR da WAHA: ${response.status} ${response.statusText}`);
        }

        // Converter para base64
        const imageBuffer = await response.arrayBuffer();
        const base64Image = Buffer.from(imageBuffer).toString('base64');
        const qrBase64 = `data:image/png;base64,${base64Image}`;

        console.log(`📱 QR convertido para base64, tamanho: ${qrBase64.length} caracteres`);

        const expiresAt = new Date(Date.now() + 300000); // 5 minutos

        // Salvar o QR base64 no banco de dados
        await WhatsAppSessionService.createOrUpdateSession({
          name: sessionName,
          status: 'SCAN_QR_CODE',
          provider: 'WAHA',
          qr: qrBase64,
          qrExpiresAt: expiresAt,
          tenantId: sessionData.tenantId
        });

        console.log(`💾 QR WAHA base64 salvo no banco para sessão ${sessionName}`);

        res.json({
          qr: qrBase64,
          expiresAt: expiresAt,
          status: 'SCAN_QR_CODE',
          provider: 'WAHA',
          message: "QR code obtido da WAHA API e convertido para base64"
        });

      } catch (qrError: any) {
        console.error('❌ Erro ao buscar QR da WAHA:', qrError);

        res.status(500).json({
          error: 'Erro ao obter QR Code da WAHA API',
          details: qrError.message
        });
      }

    } else if (effectiveStatus === 'WORKING') {
      console.log(`✅ Sessão ${sessionName} já está conectada`);
      res.status(400).json({
        error: 'Sessão já está conectada',
        status: effectiveStatus
      });

    } else {
      // Para outros status (FAILED, STOPPED), ainda retornar QR se existe no banco
      try {
        if (sessionData.qr && sessionData.qrExpiresAt && sessionData.qrExpiresAt > new Date()) {
          console.log(`📋 Retornando QR existente do banco para sessão ${sessionName} (status: ${effectiveStatus})`);
          return res.json({
            qr: sessionData.qr,
            expiresAt: sessionData.qrExpiresAt,
            status: effectiveStatus,
            message: "QR code retornado do banco (sessão não disponível)"
          });
        }
      } catch (dbError) {
        // Continua para gerar erro abaixo
      }

      console.log(`❌ Sessão ${sessionName} não está disponível para QR code`);
      res.status(400).json({
        error: 'Sessão não está disponível para QR code',
        status: effectiveStatus
      });
    }
    }

  } catch (error) {
    console.error('Erro ao obter QR Code da WAHA:', error);
    res.status(500).json({ error: 'Erro ao obter QR Code' });
  }
});

// Obter status da sessão
router.get('/sessions/:sessionName/status', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionName } = req.params;
    console.log('🔍 GET /sessions/:sessionName/status - sessionName:', sessionName, 'user:', req.user?.email, 'tenantId:', req.tenantId);

    // SUPERADMIN pode ver status de qualquer sessão, outros usuários só do seu tenant
    const tenantId = req.user?.role === 'SUPERADMIN' ? undefined : req.tenantId;

    // Verificar se a sessão pertence ao tenant
    try {
      await WhatsAppSessionService.getSession(sessionName, tenantId);
    } catch (error) {
      console.error('❌ Sessão não encontrada ou não pertence ao tenant:', error);
      return res.status(404).json({ error: 'Sessão não encontrada' });
    }

    const status = await wahaRequest(`/api/sessions/${sessionName}/status`);
    res.json(status);
  } catch (error) {
    console.error('Erro ao obter status:', error);
    res.status(500).json({ error: 'Erro ao obter status da sessão' });
  }
});

// Obter informações "me" da sessão
router.get('/sessions/:sessionName/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionName } = req.params;
    console.log('👤 GET /sessions/:sessionName/me - sessionName:', sessionName, 'user:', req.user?.email, 'tenantId:', req.tenantId);

    // SUPERADMIN pode ver informações de qualquer sessão, outros usuários só do seu tenant
    const tenantId = req.user?.role === 'SUPERADMIN' ? undefined : req.tenantId;

    // Verificar se a sessão pertence ao tenant
    try {
      await WhatsAppSessionService.getSession(sessionName, tenantId);
    } catch (error) {
      console.error('❌ Sessão não encontrada ou não pertence ao tenant:', error);
      return res.status(404).json({ error: 'Sessão não encontrada' });
    }

    const me = await wahaRequest(`/api/sessions/${sessionName}/me`);
    res.json(me);
  } catch (error) {
    console.error('Erro ao obter informações do usuário:', error);
    res.status(500).json({ error: 'Erro ao obter informações do usuário' });
  }
});

// Associar sessão a um tenant (SUPERADMIN only)
router.patch('/sessions/:sessionName/assign-tenant', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionName } = req.params;
    const { tenantId } = req.body;

    console.log('🔧 PATCH /sessions/:sessionName/assign-tenant - sessionName:', sessionName, 'tenantId:', tenantId, 'user:', req.user?.email);

    // Apenas SUPERADMIN pode associar sessões a tenants
    if (req.user?.role !== 'SUPERADMIN') {
      return res.status(403).json({ error: 'Apenas SUPERADMIN pode associar sessões a tenants' });
    }

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId é obrigatório' });
    }

    // Buscar sessão sem filtro de tenant (SUPERADMIN vê todas)
    const session = await WhatsAppSessionService.getSession(sessionName);

    // Atualizar sessão com o novo tenantId
    await WhatsAppSessionService.createOrUpdateSession({
      name: sessionName,
      status: session.status as any,
      provider: session.provider as 'WAHA' | 'EVOLUTION',
      me: session.me ? {
        id: session.me.id,
        pushName: session.me.pushName,
        lid: session.me.lid || undefined,
        jid: session.me.jid || undefined
      } : undefined,
      qr: session.qr || undefined,
      qrExpiresAt: session.qrExpiresAt || undefined,
      tenantId
    });

    console.log(`✅ Sessão ${sessionName} associada ao tenant ${tenantId}`);
    res.json({ success: true, message: 'Sessão associada ao tenant com sucesso' });
  } catch (error) {
    console.error('Erro ao associar sessão:', error);
    res.status(500).json({ error: 'Erro ao associar sessão ao tenant' });
  }
});

export default router;