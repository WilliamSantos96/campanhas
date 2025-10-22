#!/usr/bin/env node

/**
 * Script de Migração para Multi-Tenant
 *
 * Este script migra dados existentes (pre-multitenant) para um tenant específico.
 * Use com cuidado em ambiente de produção!
 */

const { PrismaClient } = require('@prisma/client');
const readline = require('readline');

const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function analyzeData() {
  console.log('🔍 Analisando dados existentes...\n');

  const [
    orphanUsers,
    orphanContacts,
    orphanCampaigns,
    orphanSessions,
    totalTenants
  ] = await Promise.all([
    prisma.user.count({ where: { tenantId: null } }),
    prisma.contact.count({ where: { tenantId: null } }),
    prisma.campaign.count({ where: { tenantId: null } }),
    prisma.whatsAppSession.count({ where: { tenantId: null } }),
    prisma.tenant.count()
  ]);

  console.log('📊 Dados sem tenant (órfãos):');
  console.log(`   👥 Usuários: ${orphanUsers}`);
  console.log(`   📱 Contatos: ${orphanContacts}`);
  console.log(`   📢 Campanhas: ${orphanCampaigns}`);
  console.log(`   💬 Sessões WhatsApp: ${orphanSessions}`);
  console.log(`\n🏢 Total de tenants existentes: ${totalTenants}\n`);

  return {
    orphanUsers,
    orphanContacts,
    orphanCampaigns,
    orphanSessions,
    totalTenants
  };
}

async function listTenants() {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      active: true,
      _count: {
        select: {
          users: true,
          contacts: true,
          campaigns: true,
          whatsappSessions: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log('🏢 Tenants disponíveis:\n');
  tenants.forEach((tenant, index) => {
    console.log(`${index + 1}. ${tenant.name} (${tenant.slug})`);
    console.log(`   ID: ${tenant.id}`);
    console.log(`   Status: ${tenant.active ? '✅ Ativo' : '❌ Inativo'}`);
    console.log(`   Dados: ${tenant._count.users} usuários, ${tenant._count.contacts} contatos, ${tenant._count.campaigns} campanhas, ${tenant._count.whatsappSessions} sessões`);
    console.log('');
  });

  return tenants;
}

async function createNewTenant() {
  console.log('🏗️ Criando novo tenant...\n');

  const slug = await question('Digite o slug do tenant (ex: empresa-abc): ');
  const name = await question('Digite o nome do tenant: ');
  const domain = await question('Digite o domínio (opcional, pressione Enter para pular): ');

  console.log('\n👤 Dados do usuário administrador:');
  const adminName = await question('Nome do administrador: ');
  const adminEmail = await question('Email do administrador: ');
  const adminPassword = await question('Senha do administrador (mín. 8 caracteres): ');

  if (adminPassword.length < 8) {
    console.log('❌ Senha deve ter pelo menos 8 caracteres!');
    return null;
  }

  try {
    // Verificar se slug já existe
    const existingTenant = await prisma.tenant.findUnique({
      where: { slug }
    });

    if (existingTenant) {
      console.log('❌ Slug já existe! Escolha outro.');
      return null;
    }

    // Verificar se email já existe
    const existingUser = await prisma.user.findUnique({
      where: { email: adminEmail }
    });

    if (existingUser) {
      console.log('❌ Email já existe! Escolha outro.');
      return null;
    }

    // Criar tenant e admin em transação
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug,
          name,
          domain: domain || null,
          active: true
        }
      });

      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash(adminPassword, 12);

      const user = await tx.user.create({
        data: {
          nome: adminName,
          email: adminEmail,
          senha: hashedPassword,
          role: 'TENANT_ADMIN',
          ativo: true,
          tenantId: tenant.id
        }
      });

      // Criar quotas padrão
      await tx.tenantQuota.create({
        data: {
          tenantId: tenant.id,
          maxUsers: 10,
          maxContacts: 1000,
          maxCampaigns: 50,
          maxConnections: 5
        }
      });

      // Criar configurações padrão
      await tx.tenantSettings.create({
        data: {
          tenantId: tenant.id
        }
      });

      return { tenant, user };
    });

    console.log('✅ Tenant criado com sucesso!');
    console.log(`   ID: ${result.tenant.id}`);
    console.log(`   Nome: ${result.tenant.name}`);
    console.log(`   Admin: ${result.user.nome} (${result.user.email})`);

    return result.tenant;
  } catch (error) {
    console.error('❌ Erro ao criar tenant:', error.message);
    return null;
  }
}

async function migrateData(tenantId, dataTypes) {
  console.log(`🚀 Iniciando migração para tenant: ${tenantId}\n`);

  const results = {
    users: 0,
    contacts: 0,
    campaigns: 0,
    sessions: 0
  };

  try {
    await prisma.$transaction(async (tx) => {
      if (dataTypes.includes('users')) {
        console.log('👥 Migrando usuários...');
        const result = await tx.user.updateMany({
          where: { tenantId: null },
          data: { tenantId }
        });
        results.users = result.count;
        console.log(`   ✅ ${result.count} usuários migrados`);
      }

      if (dataTypes.includes('contacts')) {
        console.log('📱 Migrando contatos...');
        const result = await tx.contact.updateMany({
          where: { tenantId: null },
          data: { tenantId }
        });
        results.contacts = result.count;
        console.log(`   ✅ ${result.count} contatos migrados`);
      }

      if (dataTypes.includes('campaigns')) {
        console.log('📢 Migrando campanhas...');
        const result = await tx.campaign.updateMany({
          where: { tenantId: null },
          data: { tenantId }
        });
        results.campaigns = result.count;
        console.log(`   ✅ ${result.count} campanhas migradas`);

        // Migrar mensagens de campanha também
        console.log('📧 Migrando mensagens de campanha...');
        const messagesResult = await tx.campaignMessage.updateMany({
          where: { tenantId: null },
          data: { tenantId }
        });
        console.log(`   ✅ ${messagesResult.count} mensagens migradas`);
      }

      if (dataTypes.includes('sessions')) {
        console.log('💬 Migrando sessões WhatsApp...');
        const result = await tx.whatsAppSession.updateMany({
          where: { tenantId: null },
          data: { tenantId }
        });
        results.sessions = result.count;
        console.log(`   ✅ ${result.count} sessões migradas`);
      }
    });

    console.log('\n🎉 Migração concluída com sucesso!');
    console.log('📊 Resumo:');
    console.log(`   👥 Usuários: ${results.users}`);
    console.log(`   📱 Contatos: ${results.contacts}`);
    console.log(`   📢 Campanhas: ${results.campaigns}`);
    console.log(`   💬 Sessões: ${results.sessions}`);

    return results;
  } catch (error) {
    console.error('❌ Erro durante a migração:', error.message);
    throw error;
  }
}

async function main() {
  console.log('🌟 Script de Migração Multi-Tenant\n');

  try {
    // Analisar dados
    const analysis = await analyzeData();

    if (analysis.orphanUsers === 0 &&
        analysis.orphanContacts === 0 &&
        analysis.orphanCampaigns === 0 &&
        analysis.orphanSessions === 0) {
      console.log('✅ Não há dados órfãos para migrar!');
      process.exit(0);
    }

    // Menu principal
    console.log('Escolha uma opção:');
    console.log('1. Migrar dados para tenant existente');
    console.log('2. Criar novo tenant e migrar dados');
    console.log('3. Apenas listar tenants existentes');
    console.log('4. Sair');

    const choice = await question('\nSua escolha (1-4): ');

    let selectedTenant = null;

    switch (choice) {
      case '1':
        // Listar tenants e escolher
        const tenants = await listTenants();
        if (tenants.length === 0) {
          console.log('❌ Não há tenants disponíveis. Crie um primeiro.');
          break;
        }

        const tenantIndex = await question('Digite o número do tenant: ');
        const index = parseInt(tenantIndex) - 1;

        if (index < 0 || index >= tenants.length) {
          console.log('❌ Número inválido!');
          break;
        }

        selectedTenant = tenants[index];
        break;

      case '2':
        // Criar novo tenant
        selectedTenant = await createNewTenant();
        if (!selectedTenant) break;
        console.log('');
        break;

      case '3':
        // Apenas listar
        await listTenants();
        process.exit(0);

      case '4':
        console.log('👋 Saindo...');
        process.exit(0);

      default:
        console.log('❌ Opção inválida!');
        process.exit(1);
    }

    if (!selectedTenant) {
      console.log('❌ Nenhum tenant selecionado.');
      process.exit(1);
    }

    // Confirmar migração
    console.log(`\n⚠️  ATENÇÃO: Você está prestes a migrar dados órfãos para:`);
    console.log(`   Tenant: ${selectedTenant.name} (${selectedTenant.id})`);
    console.log('\nDados que serão migrados:');
    if (analysis.orphanUsers > 0) console.log(`   👥 ${analysis.orphanUsers} usuários`);
    if (analysis.orphanContacts > 0) console.log(`   📱 ${analysis.orphanContacts} contatos`);
    if (analysis.orphanCampaigns > 0) console.log(`   📢 ${analysis.orphanCampaigns} campanhas`);
    if (analysis.orphanSessions > 0) console.log(`   💬 ${analysis.orphanSessions} sessões WhatsApp`);

    const confirm = await question('\n⚠️  Esta operação é IRREVERSÍVEL. Continuar? (sim/nao): ');

    if (confirm.toLowerCase() !== 'sim') {
      console.log('❌ Operação cancelada.');
      process.exit(0);
    }

    // Escolher tipos de dados para migrar
    console.log('\nEscolha os tipos de dados para migrar (separados por vírgula):');
    console.log('Opções: users, contacts, campaigns, sessions');
    console.log('Exemplo: contacts,campaigns');
    console.log('Digite "all" para migrar todos os tipos');

    const dataTypesInput = await question('\nTipos de dados: ');

    let dataTypes;
    if (dataTypesInput.toLowerCase() === 'all') {
      dataTypes = ['users', 'contacts', 'campaigns', 'sessions'];
    } else {
      dataTypes = dataTypesInput.split(',').map(s => s.trim().toLowerCase());
    }

    // Validar tipos
    const validTypes = ['users', 'contacts', 'campaigns', 'sessions'];
    const invalidTypes = dataTypes.filter(type => !validTypes.includes(type));

    if (invalidTypes.length > 0) {
      console.log(`❌ Tipos inválidos: ${invalidTypes.join(', ')}`);
      process.exit(1);
    }

    // Executar migração
    console.log('\n🚀 Iniciando migração...');
    await migrateData(selectedTenant.id, dataTypes);

  } catch (error) {
    console.error('❌ Erro fatal:', error.message);
    process.exit(1);
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

// Executar apenas se chamado diretamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  analyzeData,
  migrateData,
  listTenants,
  createNewTenant
};