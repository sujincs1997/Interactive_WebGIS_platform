/**
 * Telecom GIS Data Import/Export Handlers
 */

const initImportExport = () => {
  // Bind export buttons
  document.getElementById('export-geojson-btn').addEventListener('click', () => downloadNetworkFile('geojson'));
  document.getElementById('export-kml-btn').addEventListener('click', () => downloadNetworkFile('kml'));
  document.getElementById('export-csv-btn').addEventListener('click', () => downloadNetworkFile('csv'));

  // Bind import file input
  const fileInput = document.getElementById('import-file-input');
  const importZone = document.querySelector('.import-zone');

  importZone.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Detect format
    const name = file.name.toLowerCase();
    let format = '';
    if (name.endsWith('.geojson') || name.endsWith('.json')) {
      format = 'geojson';
    } else if (name.endsWith('.kml')) {
      format = 'kml';
    } else if (name.endsWith('.csv')) {
      format = 'csv';
    } else {
      alert('Unsupported file format. Please upload .geojson, .kml, or .csv files.');
      fileInput.value = '';
      return;
    }

    try {
      logConsole(`Uploading and parsing data file "${file.name}"...`, 'info');
      const result = await API.data.importFile(file, format);
      
      logConsole(result.message || 'Import completed successfully.', 'success');
      
      // Reload layers
      await reloadGISLayers();
      await loadHistory();
      
      // Reset input
      fileInput.value = '';
    } catch (err) {
      logConsole('Import failed: ' + err.message, 'error');
      fileInput.value = '';
    }
  });
};

/**
 * Request files from backend API and trigger local browser downloads
 */
const downloadNetworkFile = async (format) => {
  try {
    logConsole(`Generating ${format.toUpperCase()} export bundle...`, 'info');
    let blob;

    if (format === 'geojson') {
      blob = await API.data.exportGeoJSON();
    } else if (format === 'kml') {
      blob = await API.data.exportKML();
    } else if (format === 'csv') {
      blob = await API.data.exportCSV();
    }

    if (!blob) throw new Error('Empty file blob generated');

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    
    const filename = `telecom_export_${new Date().toISOString().slice(0, 10)}.${format === 'geojson' ? 'geojson' : format === 'kml' ? 'kml' : 'csv'}`;
    a.download = filename;
    
    document.body.appendChild(a);
    a.click();
    
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    logConsole(`Downloaded network file "${filename}".`, 'success');
  } catch (err) {
    logConsole('Export failed: ' + err.message, 'error');
  }
};
