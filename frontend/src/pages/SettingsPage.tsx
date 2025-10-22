import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Header } from '../components/Header';
import { useAuth } from '../contexts/AuthContext';

interface Settings {
  id: string;
  openaiApiKey?: string;
  groqApiKey?: string;
}

const settingsSchema = z.object({
  openaiApiKey: z.string().optional(),
  groqApiKey: z.string().optional(),
});

const zeusSchema = z.object({
  host: z.string().min(1, 'IP/Host é obrigatório'),
  port: z.coerce.number().int().positive('Porta deve ser um número positivo'),
  databaseName: z.string().min(1, 'Nome do banco é obrigatório'),
  username: z.string().min(1, 'Usuário é obrigatório'),
  password: z.string().optional(),
});

type SettingsFormData = z.infer<typeof settingsSchema>;
type ZeusFormData = z.infer<typeof zeusSchema>;

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [zeusSettings, setZeusSettings] = useState<{ hasPassword: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState<'openai' | 'groq' | 'zeus' | null>(null);
  const { user } = useAuth();

  // Helper para fazer requisições autenticadas
  const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('auth_token');
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      (headers as Record<string, string>).Authorization = `Bearer ${token}`;
    }

    return fetch(url, {
      ...options,
      headers,
    });
  };

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    onErrors: (errors) => {
      console.log('🔴 Erros de validação (IA):', errors);
    }
  });

  const {
    register: registerZeus,
    handleSubmit: handleZeusSubmit,
    setValue: setZeusValue,
    formState: { errors: zeusErrors, isSubmitting: isZeusSubmitting },
  } = useForm<ZeusFormData>({
    resolver: zodResolver(zeusSchema),
    onErrors: (errors) => {
      console.log('🔴 Erros de validação (Zeus):', errors);
    }
  });

  useEffect(() => {
    loadAllSettings();

    const handleTenantChange = () => {
      loadAllSettings();
    };

    window.addEventListener('superadmin-tenant-changed', handleTenantChange);
    return () => {
      window.removeEventListener('superadmin-tenant-changed', handleTenantChange);
    };
  }, [user]);

  const loadAllSettings = async () => {
    setLoading(true);
    await Promise.all([loadSettings(), loadZeusSettings()]);
    setLoading(false);
  };

  const loadSettings = async () => {
    try {
      let url = '/api/settings';
      if (user?.role === 'SUPERADMIN') {
        const selectedTenantId = localStorage.getItem('superadmin_selected_tenant');
        if (selectedTenantId) {
          url = `/api/settings?tenantId=${selectedTenantId}`;
        }
      }

      const response = await authenticatedFetch(url);
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        setValue('openaiApiKey', data.openaiApiKey || '');
        setValue('groqApiKey', data.groqApiKey || '');
      }
    } catch (error) {
      console.error('Erro ao carregar configurações de IA:', error);
      toast.error('Erro ao carregar configurações de IA');
    }
  };

  const loadZeusSettings = async () => {
    try {
      const response = await authenticatedFetch('/api/zeus/credentials');
      if (response.ok) {
        const data = await response.json();
        setZeusSettings(data.data);
        if (data.data) {
          setZeusValue('host', data.data.host || '');
          setZeusValue('port', data.data.port || 0);
          setZeusValue('databaseName', data.data.databaseName || '');
          setZeusValue('username', data.data.username || '');
          setZeusValue('password', ''); // Nunca preencher a senha
        }
      }
    } catch (error) {
      console.error('Erro ao carregar configurações Zeus:', error);
      toast.error('Erro ao carregar configurações do Zeus');
    }
  };

  const onIASubmit = async (data: SettingsFormData) => {
    try {
      let requestData: any = data;
      if (user?.role === 'SUPERADMIN') {
        const selectedTenantId = localStorage.getItem('superadmin_selected_tenant');
        if (selectedTenantId) {
          requestData.tenantId = selectedTenantId;
        }
      }

      const response = await authenticatedFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(requestData),
      });

      if (response.ok) {
        toast.success('Configurações de IA salvas com sucesso');
        setActiveModal(null);
        await loadSettings();
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro ao salvar configurações de IA');
      }
    } catch (error) {
      console.error('Erro ao salvar configurações de IA:', error);
      toast.error('Erro ao salvar configurações de IA');
    }
  };

  const onZeusSubmit = async (data: ZeusFormData) => {
    try {
      const response = await authenticatedFetch('/api/zeus/credentials', {
        method: 'POST',
        body: JSON.stringify(data),
      });

      if (response.ok) {
        toast.success('Configurações do Zeus salvas com sucesso');
        setActiveModal(null);
        await loadZeusSettings();
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro ao salvar configurações do Zeus');
      }
    } catch (error) {
      console.error('Erro ao salvar configurações do Zeus:', error);
      toast.error('Erro ao salvar configurações do Zeus');
    }
  };

  const removeIntegration = async (type: 'openai' | 'groq' | 'zeus') => {
    if (!confirm(`Tem certeza que deseja remover a integração com ${type.toUpperCase()}?`)) {
      return;
    }

    try {
      if (type === 'zeus') {
        const response = await authenticatedFetch('/api/zeus/credentials', { method: 'DELETE' });
        if (response.ok) {
          toast.success('Integração com Zeus removida com sucesso');
          setActiveModal(null);
          await loadZeusSettings();
        } else {
          throw new Error('Erro ao remover integração Zeus');
        }
        return;
      }

      let requestData: any = {};
      if (type === 'openai') requestData.openaiApiKey = '';
      if (type === 'groq') requestData.groqApiKey = '';

      if (user?.role === 'SUPERADMIN') {
        const selectedTenantId = localStorage.getItem('superadmin_selected_tenant');
        if (selectedTenantId) requestData.tenantId = selectedTenantId;
      }

      const response = await authenticatedFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(requestData),
      });

      if (response.ok) {
        toast.success(`Integração com ${type.toUpperCase()} removida com sucesso`);
        setActiveModal(null);
        await loadSettings();
      } else {
        throw new Error(`Erro ao remover integração ${type.toUpperCase()}`);
      }
    } catch (error) {
      console.error('Erro ao remover integração:', error);
      toast.error(error instanceof Error ? error.message : 'Erro ao remover integração');
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Carregando configurações...</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Header
        title="Configurações"
        subtitle="Configure as definições do sistema"
      />

      <div className="p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-semibold mb-6 text-gray-900">
              🔗 Integrações de IA
            </h2>
            <p className="text-gray-600 mb-6">
              Configure as chaves de API para usar inteligência artificial nas campanhas
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* OpenAI */}
              <div className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <img src="/assets/logos/openai.png" alt="OpenAI" className="w-10 h-10" />
                    <div>
                      <h3 className="font-medium text-gray-900">OpenAI</h3>
                      <p className="text-sm text-gray-500">ChatGPT, GPT-4</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${settings?.openaiApiKey ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                      {settings?.openaiApiKey ? 'Configurado' : 'Não configurado'}
                    </span>
                    <button onClick={() => setActiveModal('openai')} className="px-3 py-1 bg-gray-800 text-white text-sm rounded hover:bg-gray-900">
                      Configurar
                    </button>
                  </div>
                </div>
              </div>
              {/* Groq */}
              <div className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <img src="/assets/logos/groq.png" alt="Groq" className="w-10 h-10" />
                    <div>
                      <h3 className="font-medium text-gray-900">Groq</h3>
                      <p className="text-sm text-gray-500">LLaMA, Mixtral (ultra-rápido)</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${settings?.groqApiKey ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                      {settings?.groqApiKey ? 'Configurado' : 'Não configurado'}
                    </span>
                    <button onClick={() => setActiveModal('groq')} className="px-3 py-1 bg-orange-600 text-white text-sm rounded hover:bg-orange-700">
                      Configurar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-6 text-gray-900">
              📦 Integrações de ERP
            </h2>
            <p className="text-gray-600 mb-6">
              Conecte seu sistema de gestão para sincronizar dados.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Sistema Zeus */}
              <div className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                      <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"></path></svg>
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">Sistema Zeus</h3>
                      <p className="text-sm text-gray-500">ERP de Gestão</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${zeusSettings ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                      {zeusSettings ? 'Configurado' : 'Não configurado'}
                    </span>
                    <button onClick={() => setActiveModal('zeus')} className="px-3 py-1 bg-yellow-500 text-white text-sm rounded hover:bg-yellow-600">
                      Configurar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modais */}
      {activeModal === 'openai' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">🤖 Configurar OpenAI</h3>
              <button onClick={() => setActiveModal(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={handleSubmit(onIASubmit)} className="space-y-4">
              <div>
                <label htmlFor="openaiApiKey" className="block text-sm font-medium text-gray-700 mb-1">API Key OpenAI</label>
                <input id="openaiApiKey" type="password" {...register('openaiApiKey')} placeholder="sk-..." className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
                {errors.openaiApiKey && <p className="text-red-500 text-sm mt-1">{errors.openaiApiKey.message}</p>}
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setActiveModal(null)} className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Cancelar</button>
                {settings?.openaiApiKey && <button type="button" onClick={() => removeIntegration('openai')} disabled={isSubmitting} className="flex-1 px-4 py-2 text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50">Remover</button>}
                <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-900 disabled:opacity-50">{isSubmitting ? 'Salvando...' : 'Salvar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeModal === 'groq' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">⚡ Configurar Groq</h3>
              <button onClick={() => setActiveModal(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={handleSubmit(onIASubmit)} className="space-y-4">
              <div>
                <label htmlFor="groqApiKey" className="block text-sm font-medium text-gray-700 mb-1">API Key Groq</label>
                <input id="groqApiKey" type="password" {...register('groqApiKey')} placeholder="gsk_..." className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
                {errors.groqApiKey && <p className="text-red-500 text-sm mt-1">{errors.groqApiKey.message}</p>}
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setActiveModal(null)} className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Cancelar</button>
                {settings?.groqApiKey && <button type="button" onClick={() => removeIntegration('groq')} disabled={isSubmitting} className="flex-1 px-4 py-2 text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50">Remover</button>}
                <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50">{isSubmitting ? 'Salvando...' : 'Salvar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeModal === 'zeus' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">📦 Configurar Sistema Zeus</h3>
              <button onClick={() => setActiveModal(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={handleZeusSubmit(onZeusSubmit)} className="space-y-4">
              <div>
                <label htmlFor="zeusHost" className="block text-sm font-medium text-gray-700 mb-1">IP / Host *</label>
                <input id="zeusHost" type="text" {...registerZeus('host')} placeholder="192.168.0.1" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                {zeusErrors.host && <p className="text-red-500 text-sm mt-1">{zeusErrors.host.message}</p>}
              </div>
              <div>
                <label htmlFor="zeusPort" className="block text-sm font-medium text-gray-700 mb-1">Porta *</label>
                <input id="zeusPort" type="number" {...registerZeus('port')} placeholder="3050" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                {zeusErrors.port && <p className="text-red-500 text-sm mt-1">{zeusErrors.port.message}</p>}
              </div>
              <div>
                <label htmlFor="zeusDatabase" className="block text-sm font-medium text-gray-700 mb-1">Banco de Dados *</label>
                <input id="zeusDatabase" type="text" {...registerZeus('databaseName')} placeholder="C:\Zeus\DB.FDB" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                {zeusErrors.databaseName && <p className="text-red-500 text-sm mt-1">{zeusErrors.databaseName.message}</p>}
              </div>
              <div>
                <label htmlFor="zeusUser" className="block text-sm font-medium text-gray-700 mb-1">Usuário *</label>
                <input id="zeusUser" type="text" {...registerZeus('username')} placeholder="SYSDBA" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                {zeusErrors.username && <p className="text-red-500 text-sm mt-1">{zeusErrors.username.message}</p>}
              </div>
              <div>
                <label htmlFor="zeusPassword" className="block text-sm font-medium text-gray-700 mb-1">Senha {zeusSettings?.hasPassword ? '(deixe em branco para manter)' : '*'}</label>
                <input id="zeusPassword" type="password" {...registerZeus('password')} placeholder="••••••••" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                {zeusErrors.password && <p className="text-red-500 text-sm mt-1">{zeusErrors.password.message}</p>}
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setActiveModal(null)} className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Cancelar</button>
                {zeusSettings && <button type="button" onClick={() => removeIntegration('zeus')} disabled={isZeusSubmitting} className="flex-1 px-4 py-2 text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50">Remover</button>}
                <button type="submit" disabled={isZeusSubmitting} className="flex-1 px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 disabled:opacity-50">{isZeusSubmitting ? 'Salvando...' : 'Salvar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}