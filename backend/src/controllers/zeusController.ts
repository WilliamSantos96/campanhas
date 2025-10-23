import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { ZeusService } from '../services/zeusService';
import { z } from 'zod';

// Schema de validação para os dados de entrada
const credentialsSchema = z.object({
  host: z.string().min(1, 'Host é obrigatório'),
  port: z.union([
    z.number().int().positive('Porta deve ser um número positivo'),
    z.string().min(1, 'Porta é obrigatória').transform((val) => {
      const num = parseInt(val, 10);
      if (isNaN(num) || num <= 0) {
        throw new Error('Porta deve ser um número positivo');
      }
      return num;
    })
  ]),
  databaseName: z.string().min(1, 'Nome do banco é obrigatório'),
  username: z.string().min(1, 'Usuário é obrigatório'),
  password: z.string().optional().or(z.literal('')), // Senha é opcional, pode não ser alterada
});

export class ZeusController {
  static async getCredentials(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).json({ success: false, message: 'Tenant não identificado' });
      }
      const credentials = await ZeusService.getCredentials(req.tenantId);
      res.json({ success: true, data: credentials });
    } catch (error) {
      console.error('Erro ao buscar credenciais Zeus:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }

  static async saveCredentials(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).json({ success: false, message: 'Tenant não identificado' });
      }

      const validation = credentialsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ success: false, message: 'Dados inválidos', errors: validation.error.errors });
      }

      const credentials = await ZeusService.upsertCredentials(req.tenantId, validation.data);
      res.status(200).json({ success: true, message: 'Credenciais salvas com sucesso', data: credentials });
    } catch (error) {
      console.error('Erro ao salvar credenciais Zeus:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }

  static async deleteCredentials(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).json({ success: false, message: 'Tenant não identificado' });
      }
      await ZeusService.deleteCredentials(req.tenantId);
      res.json({ success: true, message: 'Credenciais removidas com sucesso' });
    } catch (error) {
      console.error('Erro ao remover credenciais Zeus:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }
}