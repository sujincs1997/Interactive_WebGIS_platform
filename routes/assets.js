const express = require('express');
const router = express.Router();
const assetController = require('../controllers/assetController');
const auth = require('../middleware/auth');

// ==========================================
// ASSET ROUTES (POINTS)
// ==========================================
router.get('/assets', auth, assetController.getAssets);
router.post('/assets', auth, assetController.createAsset);
router.put('/assets/:id', auth, assetController.updateAsset);
router.delete('/assets/:id', auth, assetController.deleteAsset);
router.post('/assets/:id/recover', auth, assetController.recoverAsset);

// ==========================================
// ROUTE ROUTES (LINES)
// ==========================================
router.get('/routes', auth, assetController.getRoutes);
router.post('/routes', auth, assetController.createRoute);
router.put('/routes/:id', auth, assetController.updateRoute);
router.delete('/routes/:id', auth, assetController.deleteRoute);
router.post('/routes/:id/recover', auth, assetController.recoverRoute);

// Advanced Editing Tools
router.post('/routes/split', auth, assetController.splitRoute);
router.post('/routes/merge', auth, assetController.mergeRoutes);

// ==========================================
// AUDIT & HISTORIC LOG ROUTES
// ==========================================
router.get('/history', auth, assetController.getHistory);
router.post('/history/undo', auth, assetController.undoAction);

module.exports = router;
