/**
 * Telecom GIS Network Tracing & Routing Analysis Module
 */

let traceStartNodeId = null;
let traceEndNodeId = null;

// ==========================================
// TRACE HIGHLIGHT RENDERING
// ==========================================

const clearTraceHighlights = () => {
  traceHighlightGroup.clearLayers();
  document.getElementById('clear-trace-btn').style.display = 'none';
  logConsole('Map tracing highlights cleared.', 'info');
};

/**
 * Render trace results (feature collection of assets and routes) on the map in high visibility neon.
 */
const renderTraceHighlights = (traceData, isServiceImpact = false) => {
  clearTraceHighlights();

  const routes = traceData.routes;
  const assets = traceData.assets;

  // 1. Highlight Line routes (Cables)
  if (routes && routes.features) {
    routes.features.forEach(route => {
      const coords = route.geometry.coordinates;
      const latlngs = coords.map(c => [c[1], c[0]]);

      // Glowing outer yellow/orange trace line
      const glowPolyline = L.polyline(latlngs, {
        color: isServiceImpact ? '#ff1744' : '#ffff00',
        weight: 10,
        opacity: 0.4,
        lineCap: 'round'
      }).addTo(traceHighlightGroup);

      // Inner glowing core
      const corePolyline = L.polyline(latlngs, {
        color: '#ffffff',
        weight: 3,
        opacity: 1.0,
        lineCap: 'round'
      }).addTo(traceHighlightGroup);
    });
  }

  // 2. Highlight Node assets
  if (assets && assets.features) {
    assets.features.forEach(asset => {
      const coords = asset.geometry.coordinates;
      const latlng = [coords[1], coords[0]];

      // Visual pulsing circle indicator around traced equipment
      const markerHighlight = L.circleMarker(latlng, {
        radius: 12,
        color: isServiceImpact ? '#ff1744' : '#ffea00',
        fillColor: isServiceImpact ? '#d50000' : '#ffd600',
        fillOpacity: 0.4,
        weight: 2,
        className: 'animate-pulse'
      }).addTo(traceHighlightGroup);

      // Bind simple tooltip
      markerHighlight.bindTooltip(`Traced: ${asset.properties.name} (${asset.properties.asset_type.toUpperCase()})`, {
        permanent: false,
        direction: 'top'
      });
    });
  }

  // Zoom map to cover the full boundaries of the trace highlights
  if (traceHighlightGroup.getLayers().length > 0) {
    const bounds = traceHighlightGroup.getBounds();
    map.fitBounds(bounds, { padding: [80, 80] });
    document.getElementById('clear-trace-btn').style.display = 'block';
  }
};

// ==========================================
// TRACE ANALYSIS RUNNERS
// ==========================================

const executeNetworkAnalysis = async () => {
  const traceType = document.getElementById('trace-type-select').value;
  
  // Verify start node selection
  if (!selectedFeature && traceType !== 'shortest' && traceType !== 'impact') {
    alert('Please click on a network asset or cable route on the map first to set it as the trace origin.');
    return;
  }

  try {
    logConsole(`Executing ${traceType.toUpperCase()} network analysis...`, 'info');
    
    if (traceType === 'upstream') {
      const id = selectedFeature.id;
      if (selectedFeature.type !== 'asset') {
        alert('Upstream tracing must start from a node asset (e.g. Customer ONT or Splitter).');
        return;
      }
      
      const traceResult = await API.trace.upstream(id);
      renderTraceHighlights(traceResult);
      
      // Calculate length and summary
      const summary = compileTraceMetrics(traceResult);
      logConsole(`Upstream Trace complete: Paths found leading to OLT. Total path cables: ${summary.cableDistance.toFixed(1)}m. Connected Nodes: ${summary.nodeCount}.`, 'success');
      showTraceSummaryCard(`Upstream Trace Result from Node #${id}`, summary);
    } 
    else if (traceType === 'downstream') {
      const id = selectedFeature.id;
      if (selectedFeature.type !== 'asset') {
        alert('Downstream tracing must start from a node asset (e.g. OLT Central Office or Cabinet).');
        return;
      }

      const traceResult = await API.trace.downstream(id);
      renderTraceHighlights(traceResult);
      
      const summary = compileTraceMetrics(traceResult);
      logConsole(`Downstream Trace complete: Traced feeds down towards endpoints. Total cable lines: ${summary.cableDistance.toFixed(1)}m. Affected nodes: ${summary.nodeCount}.`, 'success');
      showTraceSummaryCard(`Downstream Trace Result from Node #${id}`, summary);
    }
    else if (traceType === 'full') {
      const id = selectedFeature.id;
      const traceResult = selectedFeature.type === 'asset' 
        ? await API.trace.full(id) 
        : { assets: { features: [] }, routes: { features: [selectedFeature.layer.toGeoJSON()] } }; // basic fallback
      
      renderTraceHighlights(traceResult);
      
      const summary = compileTraceMetrics(traceResult);
      logConsole(`Full Loop Network Trace complete: Fetched all components in the electrical graph. Total cables: ${summary.cableDistance.toFixed(1)}m. Connected assets: ${summary.nodeCount}.`, 'success');
      showTraceSummaryCard(`Full Network Cluster #${id}`, summary);
    }
    else if (traceType === 'shortest') {
      if (!traceStartNodeId || !traceEndNodeId) {
        alert('Shortest Path requires setting both start and end nodes. Select them by choosing assets in the properties sidebar.');
        return;
      }

      const pathResult = await API.trace.shortestPath(traceStartNodeId, traceEndNodeId);
      renderTraceHighlights(pathResult);
      
      logConsole(`Shortest Path Analysis complete: Connection path found. Total distance: ${pathResult.pathLengthMeters.toFixed(1)}m.`, 'success');
      
      const summary = compileTraceMetrics(pathResult);
      showTraceSummaryCard(`Shortest Path Node #${traceStartNodeId} to Node #${traceEndNodeId}`, {
        ...summary,
        customDistance: pathResult.pathLengthMeters
      });
    }
    else if (traceType === 'impact') {
      if (!selectedFeature) {
        alert('Please select the cable route or node asset where you want to simulate a failure.');
        return;
      }

      const nodeType = selectedFeature.type; // 'asset' or 'route'
      const id = selectedFeature.id;

      const impactResult = await API.trace.serviceImpact(nodeType, id);
      
      // Render highlights as service cuts (pulsing red markers)
      renderTraceHighlights({
        assets: impactResult.affectedCustomers,
        routes: nodeType === 'route' ? { features: [selectedFeature.layer.toGeoJSON()] } : { features: [] }
      }, true);

      logConsole(`Service Impact Analysis complete: Cut simulation triggered. Isolated Customers: ${impactResult.totalCustomersCut}. Details: ${impactResult.cutDetails}`, 'warn');
      
      // Show service impact window
      showImpactSummaryCard(id, nodeType, impactResult);
    }

  } catch (err) {
    logConsole('Tracing failed: ' + err.message, 'error');
  }
};

// ==========================================
// METRICS ENGINE
// ==========================================
/**
 * Iterates through raw GeoJSON trace collections to calculate path length, node type statistics, etc.
 */
const compileTraceMetrics = (traceResult) => {
  let cableDistance = 0;
  let nodeCount = 0;
  const types = {};

  if (traceResult.routes && traceResult.routes.features) {
    traceResult.routes.features.forEach(r => {
      cableDistance += parseFloat(r.properties.length_meters || 0);
    });
  }

  if (traceResult.assets && traceResult.assets.features) {
    nodeCount = traceResult.assets.features.length;
    traceResult.assets.features.forEach(a => {
      const type = a.properties.asset_type;
      types[type] = (types[type] || 0) + 1;
    });
  }

  return {
    cableDistance,
    nodeCount,
    types
  };
};

// ==========================================
// PANEL DISPLAY HELPER FUNCTIONS
// ==========================================

const showTraceSummaryCard = (title, summary) => {
  const consolePanel = document.getElementById('console-logs-list');
  
  // Format HTML summary
  const dist = summary.customDistance ? summary.customDistance : summary.cableDistance;
  let statsHTML = `
    <div class="log-row info" style="margin-top: 8px; padding-bottom: 8px; background-color: rgba(255, 234, 0, 0.04); border-left-color: #ffea00;">
      <strong>📊 NETWORK METRIC SUMMARY: ${title.toUpperCase()}</strong><br>
      • Total Fiber Route Distance: <strong>${dist.toFixed(1)} meters</strong><br>
      • Total Connected Equipment: <strong>${summary.nodeCount} assets</strong><br>
  `;

  Object.keys(summary.types).forEach(type => {
    statsHTML += `      - ${type.toUpperCase()}: <strong>${summary.types[type]} node(s)</strong><br>`;
  });

  statsHTML += `</div>`;
  
  consolePanel.innerHTML += statsHTML;
  consolePanel.scrollTop = consolePanel.scrollHeight;
  
  // Open the bottom panel if it is collapsed
  const panel = document.getElementById('bottom-panel');
  if (panel.classList.contains('collapsed')) {
    panel.classList.remove('collapsed');
    document.getElementById('panel-toggle-btn').innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
  }
};

const showImpactSummaryCard = (id, type, impactResult) => {
  const consolePanel = document.getElementById('console-logs-list');
  const count = impactResult.totalCustomersCut;

  let statsHTML = `
    <div class="log-row error" style="margin-top: 8px; padding-bottom: 8px; background-color: rgba(255, 23, 68, 0.05); border-left-color: #ff1744;">
      <strong>⚠️ CRITICAL SERVICE IMPACT REPORT</strong><br>
      • Simulated Failure: <strong>${type.toUpperCase()} Segment ID #${id}</strong><br>
      • Isolated Sinks (Active Customers Out): <strong style="font-size: 14px; text-decoration: underline;">${count} Customers affected</strong><br>
      • Alarm level: <strong>${count > 5 ? 'CRITICAL - HIGH DENSITY OUTAGE' : count > 0 ? 'MAJOR - PREMISE ISOLATION' : 'NOTICE - NO ACTIVE SUBSCRIBERS'}</strong><br>
      • System note: <em>Subscribers will flash orange on the map to assist dispatch field crews.</em>
    </div>
  `;

  consolePanel.innerHTML += statsHTML;
  consolePanel.scrollTop = consolePanel.scrollHeight;

  const panel = document.getElementById('bottom-panel');
  if (panel.classList.contains('collapsed')) {
    panel.classList.remove('collapsed');
    document.getElementById('panel-toggle-btn').innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
  }
};
