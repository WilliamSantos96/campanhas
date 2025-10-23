import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class SettingsService {
  private static instance: SettingsService;
  private cachedSettings: any = null;

  public static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService();
    }
    return SettingsService.instance;
  }

  async getSettings() {
    try {
      // Buscar configurações globais do banco
      let settings = await prisma.globalSettings.findFirst();

      // Se não existir, criar configuração padrão
      if (!settings) {
        settings = await prisma.globalSettings.create({
          data: {
            singleton: true,
            wahaHost: '',
            wahaApiKey: '',
            evolutionHost: '',
            evolutionApiKey: '',
            companyName: 'Astra Campaign',
            pageTitle: 'Sistema de Gestão de Contatos',
            iconUrl: '/api/uploads/default_icon.png',
            faviconUrl: '/api/uploads/default_favicon.png'
          }
        });
      }

      this.cachedSettings = settings;
      return settings;
    } catch (error) {
      console.error('Error getting settings:', error);
      // Retornar configurações padrão se houver erro
      return {
        wahaHost: '',
        wahaApiKey: '',
        evolutionHost: '',
        evolutionApiKey: '',
        quepasaUrl: '',
        quepasaLogin: '',
        quepasaPassword: '',
        companyName: '',
        logoUrl: null,
        faviconUrl: '/api/uploads/default_favicon.png',
        pageTitle: 'Sistema de Gestão de Contatos',
        iconUrl: '/api/uploads/default_icon.png'
      };
    }
  }

  async updateSettings(data: {
    wahaHost?: string;
    wahaApiKey?: string;
    evolutionHost?: string;
    evolutionApiKey?: string;
    quepasaUrl?: string;
    quepasaLogin?: string;
    quepasaPassword?: string;
    logoUrl?: string | null;
    companyName?: string;
    faviconUrl?: string | null;
    pageTitle?: string;
    iconUrl?: string | null;
  }) {
    try {
      // Buscar configuração existente
      let settings = await prisma.globalSettings.findFirst();

      if (settings) {
        // Atualizar configuração existente
        settings = await prisma.globalSettings.update({
          where: { id: settings.id },
          data: {
            wahaHost: data.wahaHost !== undefined ? data.wahaHost : settings.wahaHost,
            wahaApiKey: data.wahaApiKey !== undefined ? data.wahaApiKey : settings.wahaApiKey,
            evolutionHost: data.evolutionHost !== undefined ? data.evolutionHost : settings.evolutionHost,
            evolutionApiKey: data.evolutionApiKey !== undefined ? data.evolutionApiKey : settings.evolutionApiKey,
            quepasaUrl: data.quepasaUrl !== undefined ? data.quepasaUrl : settings.quepasaUrl,
            quepasaLogin: data.quepasaLogin !== undefined ? data.quepasaLogin : settings.quepasaLogin,
            quepasaPassword: data.quepasaPassword !== undefined ? data.quepasaPassword : settings.quepasaPassword,
            logoUrl: data.logoUrl !== undefined ? data.logoUrl : settings.logoUrl,
            companyName: data.companyName !== undefined ? data.companyName : settings.companyName,
            faviconUrl: data.faviconUrl !== undefined ? data.faviconUrl : settings.faviconUrl,
            pageTitle: data.pageTitle !== undefined ? data.pageTitle : settings.pageTitle,
            iconUrl: data.iconUrl !== undefined ? data.iconUrl : settings.iconUrl
          }
        });
      } else {
        // Criar nova configuração
        settings = await prisma.globalSettings.create({
          data: {
            singleton: true,
            wahaHost: data.wahaHost || '',
            wahaApiKey: data.wahaApiKey || '',
            evolutionHost: data.evolutionHost || '',
            evolutionApiKey: data.evolutionApiKey || '',
            quepasaUrl: data.quepasaUrl || '',
            quepasaLogin: data.quepasaLogin || '',
            quepasaPassword: data.quepasaPassword || '',
            logoUrl: data.logoUrl || null,
            companyName: data.companyName || 'Astra Campaign',
            faviconUrl: data.faviconUrl || '/api/uploads/default_favicon.png',
            pageTitle: data.pageTitle || 'Sistema de Gestão de Contatos',
            iconUrl: data.iconUrl || '/api/uploads/default_icon.png'
          }
        });
      }

      // Limpar cache
      this.cachedSettings = null;

      return settings;
    } catch (error) {
      console.error('Error updating settings:', error);
      throw error;
    }
  }

  // Método para obter configurações de forma síncrona (para cache)
  getCachedSettings() {
    return this.cachedSettings;
  }

  // Método para obter configurações WAHA especificamente
  async getWahaConfig() {
    const settings = await this.getSettings();
    return {
      host: settings.wahaHost,
      apiKey: settings.wahaApiKey
    };
  }

  // Método para obter configurações Evolution especificamente
  async getEvolutionConfig() {
    const settings = await this.getSettings();
    return {
      host: settings.evolutionHost,
      apiKey: settings.evolutionApiKey
    };
  }

  // Método para obter configurações Quepasa especificamente
  async getQuepasaConfig() {
    const settings = await this.getSettings();
    return {
      url: settings.quepasaUrl,
      login: settings.quepasaLogin,
      password: settings.quepasaPassword
    };
  }
}

export const settingsService = SettingsService.getInstance();