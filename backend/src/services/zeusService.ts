import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface ZeusCredentialsInput {
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password?: string; // A senha é opcional na atualização para não forçar a redigitação
}

export class ZeusService {
  /**
   * Busca as credenciais do Zeus para um tenant, omitindo a senha.
   */
  static async getCredentials(tenantId: string) {
    const credentials = await prisma.credentialsZeus.findUnique({
      where: { tenantId },
    });

    if (credentials) {
      // Nunca retornar a senha para o frontend
      const { password, ...rest } = credentials;
      return { ...rest, hasPassword: !!password && password.length > 0 };
    }
    return null;
  }

  /**
   * Cria ou atualiza as credenciais do Zeus para um tenant.
   */
  static async upsertCredentials(tenantId: string, data: ZeusCredentialsInput) {
    const upsertData: any = {
      host: data.host,
      port: data.port,
      databaseName: data.databaseName,
      username: data.username,
      tenantId: tenantId,
    };

    // Apenas atualiza a senha se uma nova for fornecida
    if (data.password && data.password.length > 0) {
      upsertData.password = data.password;
    }

    return prisma.credentialsZeus.upsert({
      where: { tenantId },
      update: upsertData,
      create: {
        ...upsertData,
        // Garante que a senha seja definida na criação
        password: data.password || '',
      },
    });
  }

  /**
   * Remove as credenciais do Zeus para um tenant.
   */
  static async deleteCredentials(tenantId: string) {
    // Usar deleteMany para evitar erro se não existir
    return prisma.credentialsZeus.deleteMany({
      where: { tenantId },
    });
  }
}