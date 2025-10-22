import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Header } from '../components/Header';
import { useAuth } from '../contexts/AuthContext';

interface Settings {
  id: string;
  wahaHost: string;
  wahaApiKey: string;
  evolutionHost: string;
  evolutionApiKey: string;
  zeusHost?: string;
  zeusPort?: number;
  zeusDatabase?: string;
  zeusUsername?: string;
  zeusPassword?: string;
  logoUrl?: string;
  companyName?: string;
  faviconUrl?: string;
  pageTitle?: string;
  iconUrl?: string;
  criadoEm: string;
  atualizadoEm: string;
}

const settingsSchema = z.object({
  wahaHost: z.string().optional(),
  wahaApiKey: z.string().optional(),
  evolutionHost: z.string().optional(),
  evolutionApiKey: z.string().optional(),
  zeusHost: z.string().optional(),
  zeusPort: z.coerce.number().min(1).max(65535).optional(),
  zeusDatabase: z.string().optional(),
  zeusUsername: z.string().optional(),
  zeusPassword: z.string().optional(),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
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
  });

  useEffect(() => {
    loadSettings();

    // Listen for tenant changes from header selector
    const handleTenantChange = () => {
      loadSettings();
    };

    window.addEventListener('superadmin-tenant-changed', handleTenantChange);
    return () => {
      window.removeEventListener('superadmin-tenant-changed', handleTenantChange);
    };
  }, [user]);

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
        setValue('wahaHost', data.wahaHost || '');
        setValue('wahaApiKey', data.wahaApiKey || '');
        setValue('evolutionHost', data.evolutionHost || '');
        setValue('evolutionApiKey', data.evolutionApiKey || '');
        setValue('zeusHost', data.zeusHost || '');
        setValue('zeusPort', data.zeusPort || '');
        setValue('zeusDatabase', data.zeusDatabase || '');
        setValue('zeusUsername', data.zeusUsername || '');
        setValue('zeusPassword', data.zeusPassword || '');
      }
    } catch (error) {
      console.error('Erro ao carregar configurações:', error);
      toast.error('Erro ao carregar configurações');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (data: SettingsFormData) => {
    try {
      let requestData = data;

      if (user?.role === 'SUPERADMIN') {
        const selectedTenantId = localStorage.getItem('superadmin_selected_tenant');
        if (selectedTenantId) {
          requestData = { ...data, tenantId: selectedTenantId };
        }
      }

      const response = await authenticatedFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(requestData),
      });

      if (response.ok) {
        const responseData = await response.json();
        toast.success('Configurações salvas com sucesso');
        setActiveModal(null);
        await loadSettings();
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro ao salvar configurações');
      }
    } catch (error) {
      console.error('Erro ao salvar configurações:', error);
      toast.error('Erro ao salvar configurações');
    }
  };

  const removeIntegration = async (type: 'openai' | 'groq' | 'zeus') => {
    if (!confirm(`Tem certeza que deseja remover a integração com ${type === 'openai' ? 'OpenAI' : type === 'zeus' ? 'Zeus ERP' : 'Groq'}?`)) {
      return;
    }

    try {
      let requestData: any = {};

      if (type === 'openai') {
        requestData.openaiApiKey = '';
      } else if (type === 'groq') {
        requestData.groqApiKey = '';
      } else if (type === 'zeus') {
        requestData.zeusHost = '';
        requestData.zeusPort = undefined;
        requestData.zeusDatabase = '';
        requestData.zeusUsername = '';
        requestData.zeusPassword = '';
      }

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
        toast.success(`Integração com ${type === 'openai' ? 'OpenAI' : type === 'zeus' ? 'Zeus ERP' : 'Groq'} removida com sucesso`);
        setActiveModal(null);
        await loadSettings();
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro ao remover integração');
      }
    } catch (error) {
      console.error('Erro ao remover integração:', error);
      toast.error('Erro ao remover integração');
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
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-6 text-gray-900">
              🔗 Integrações de IA
            </h2>
            <p className="text-gray-600 mb-6">
              Configure as chaves de API para usar inteligência artificial nas campanhas
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* OpenAI Button */}
              <div className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                      <span className="text-green-600 font-semibold">🤖</span>
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">OpenAI</h3>
                      <p className="text-sm text-gray-500">ChatGPT, GPT-4</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      settings?.openaiApiKey
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {settings?.openaiApiKey ? 'Configurado' : 'Não configurado'}
                    </span>
                    <button
                      onClick={() => setActiveModal('openai')}
                      className="px-3 py-1 bg-gray-800 text-white text-sm rounded hover:bg-gray-900"
                    >
                      Configurar
                    </button>
                  </div>
                </div>
              </div>

              {/* Groq Button */}
              <div className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                      <span className="text-orange-600 font-semibold">⚡</span>
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">Groq</h3>
                      <p className="text-sm text-gray-500">LLaMA, Mixtral (ultra-rápido)</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      settings?.groqApiKey
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {settings?.groqApiKey ? 'Configurado' : 'Não configurado'}
                    </span>
                    <button
                      onClick={() => setActiveModal('groq')}
                      className="px-3 py-1 bg-orange-600 text-white text-sm rounded hover:bg-orange-700"
                    >
                      Configurar
                    </button>
                  </div>
                </div>
              </div>

              {/* Zeus ERP Button */}
              <div className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                      <span className="text-indigo-600 font-semibold">⚙️</span>
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">Zeus ERP</h3>
                      <p className="text-sm text-gray-500">Integração com sistema ERP</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      settings?.zeusHost && settings?.zeusUsername
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {settings?.zeusHost && settings?.zeusUsername ? 'Configurado' : 'Não configurado'}
                    </span>
                    <button
                      onClick={() => setActiveModal('zeus')}
                      className="px-3 py-1 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700"
                    >
                      Configurar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal OpenAI */}
      {activeModal === 'openai' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">🤖 Configurar OpenAI</h3>
              <button
                onClick={() => setActiveModal(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label htmlFor="openaiApiKey" className="block text-sm font-medium text-gray-700 mb-1">
                  API Key OpenAI
                </label>
                <input
                  id="openaiApiKey"
                  type="password"
                  {...register('openaiApiKey')}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {errors.openaiApiKey && (
                  <p className="text-red-500 text-sm mt-1">
                    {errors.openaiApiKey.message}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Chave API para integração com ChatGPT nas campanhas
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  Cancelar
                </button>
                {settings?.openaiApiKey && (
                  <button
                    type="button"
                    onClick={() => removeIntegration('openai')}
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2 text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
                  >
                    Remover
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-900 disabled:opacity-50"
                >
                  {isSubmitting ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Groq */}
      {activeModal === 'groq' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">⚡ Configurar Groq</h3>
              <button
                onClick={() => setActiveModal(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label htmlFor="groqApiKey" className="block text-sm font-medium text-gray-700 mb-1">
                  API Key Groq
                </label>
                <input
                  id="groqApiKey"
                  type="password"
                  {...register('groqApiKey')}
                  placeholder="gsk_..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {errors.groqApiKey && (
                  <p className="text-red-500 text-sm mt-1">
                    {errors.groqApiKey.message}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Chave API para integração com Groq AI nas campanhas (modelos rápidos e eficientes)
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  Cancelar
                </button>
                {settings?.groqApiKey && (
                  <button
                    type="button"
                    onClick={() => removeIntegration('groq')}
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2 text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
                  >
                    Remover
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50"
                >
                  {isSubmitting ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Zeus ERP */}
      {activeModal === 'zeus' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">⚙️ Configurar Zeus ERP</h3>
              <button
                onClick={() => setActiveModal(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label htmlFor="zeusHost" className="block text-sm font-medium text-gray-700 mb-1">
                  Host/IP *
                </label>
                <input
                  id="zeusHost"
                  type="text"
                  {...register('zeusHost')}
                  placeholder="Ex: 192.168.1.100 ou db.exemplo.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {errors.zeusHost && (
                  <p className="text-red-500 text-sm mt-1">
                    {errors.zeusHost.message}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Endereço do servidor do Zeus ERP
                </p>
              </div>

              <div>
                <label htmlFor="zeusPort" className="block text-sm font-medium text-gray-700 mb-1">
                  Porta *
                </label>
                <input
                  id="zeusPort"
                  type="number"
                  {...register('zeusPort', { valueAsNumber: true })}
                  min={1}
                  max={65535}
                  placeholder="Ex: 5432"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {errors.zeusPort && (
                  <p className="text-red-500 text-sm mt-1">
                    {errors.zeusPort.message}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Porta do banco de dados (padrão: 5432 para PostgreSQL)
                </p>
              </div>

              <div>
                <label htmlFor="zeusDatabase" className="block text-sm font-medium text-gray-700 mb-1">
                  Nome do Banco *
                </label>
                <input
                  id="zeusDatabase"
                  type="text"
                  {...register('zeusDatabase')}
                  placeholder="Ex: zeus_prod"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {errors.zeusDatabase && (
                  <p className="text-red-500 text-sm mt-1">
                    {errors.zeusDatabase.message}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Nome do banco de dados do Zeus ERP
                </p>
              </div>

              <div>
                <label htmlFor="zeusUsername" className="block text-sm font-medium text-gray-700 mb-1">
                  Usuário *
                </label>
                <input
                  id="zeusUsername"
                  type="text"
                  {...register('zeusUsername')}
                  placeholder="Ex: zeus_user"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {errors.zeusUsername && (
                  <p className="text-red-500 text-sm mt-1">
                    {errors.zeusUsername.message}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Usuário do banco de dados
                </p>
              </div>

              <div>
                <label htmlFor="zeusPassword" className="block text-sm font-medium text-gray-700 mb-1">
                  Senha *
                </label>
                <input
                  id="zeusPassword"
                  type="password"
                  {...register('zeusPassword')}
                  placeholder="Senha do banco"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {errors.zeusPassword && (
                  <p className="text-red-500 text-sm mt-1">
                    {errors.zeusPassword.message}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Senha do banco de dados do Zeus ERP
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  Cancelar
                </button>
                {settings?.zeusHost && (
                  <button
                    type="button"
                    onClick={() => removeIntegration('zeus')}
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2 text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
                  >
                    Remover
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSubmitting ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}