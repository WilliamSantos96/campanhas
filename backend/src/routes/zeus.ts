import { Router } from 'express';
import { ZeusController } from '../controllers/zeusController';

const router = Router();

// GET /api/zeus/credentials - Busca as credenciais (sem a senha)
router.get('/credentials', ZeusController.getCredentials);

// POST /api/zeus/credentials - Salva ou atualiza as credenciais
router.post('/credentials', ZeusController.saveCredentials);

// DELETE /api/zeus/credentials - Remove as credenciais
router.delete('/credentials', ZeusController.deleteCredentials);

export default router;