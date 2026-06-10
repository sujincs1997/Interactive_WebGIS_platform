const express = require('express');
const router = express.Router();
const multer = require('multer');
const dataController = require('../controllers/dataController');
const auth = require('../middleware/auth');

// Multer memory storage configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // limit file size to 10MB
  }
});

// ==========================================
// EXPORT ENDPOINTS
// ==========================================
router.get('/export/geojson', auth, dataController.exportGeoJSON);
router.get('/export/csv', auth, dataController.exportCSV);
router.get('/export/kml', auth, dataController.exportKML);

// ==========================================
// IMPORT ENDPOINTS (ACID verified)
// ==========================================
router.post('/import/geojson', auth, upload.single('file'), dataController.importGeoJSON);
router.post('/import/csv', auth, upload.single('file'), dataController.importCSV);
router.post('/import/kml', auth, upload.single('file'), dataController.importKML);
router.post('/import/shapefile', auth, upload.single('file'), dataController.importShapefile);

module.exports = router;
