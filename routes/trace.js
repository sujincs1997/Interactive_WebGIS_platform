const express = require('express');
const router = express.Router();
const traceController = require('../controllers/traceController');
const auth = require('../middleware/auth');

// ==========================================
// CONNECTIVITY TOPOLOGY ROUTES
// ==========================================
router.get('/links', auth, traceController.getLinks);
router.post('/link', auth, traceController.createLink);
router.delete('/link/:id', auth, traceController.deleteLink);

// ==========================================
// NETWORK TRACING ENGINE ROUTES
// ==========================================
router.get('/upstream/:id', auth, traceController.upstreamTrace);
router.get('/downstream/:id', auth, traceController.downstreamTrace);
router.get('/full/:id', auth, traceController.fullTrace);
router.post('/shortest-path', auth, traceController.shortestPath);
router.post('/service-impact', auth, traceController.serviceImpact);
router.get('/utilization', auth, traceController.utilizationSummary);

module.exports = router;
