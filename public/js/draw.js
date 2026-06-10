/**
 * Map Editing & Drawing Module (with Turf.js Snapping)
 */
let drawingMode = null; // 'point', 'line', 'split', 'merge'
let tempDrawLayer = null; // holds L.marker or L.polyline during active creation
let activeDrawPoints = []; // coordinates array for polylines
let snappingEnabled = true;

// Snapping distance threshold in meters
const SNAP_THRESHOLD_METERS = 15; 

// ==========================================
// DRAWING STATE CHECKS
// ==========================================
const isDrawingActive = () => drawingMode !== null;

// ==========================================
// SNAPPING UTILITY
// ==========================================
/**
 * Calculates if a given latlng is close to any existing asset marker.
 * If yes, returns the snapped coordinates. If not, returns original latlng.
 */
const getSnappedLatLng = (latlng) => {
  if (!snappingEnabled) return latlng;

  let closestLatLng = latlng;
  let minDistance = Infinity;

  // Scan all markers in asset layers
  Object.keys(leafletLayers.asset).forEach(id => {
    const marker = leafletLayers.asset[id];
    if (marker && marker.properties && !marker.properties.is_deleted) {
      const markerLatLng = marker.getLatLng();
      
      // Calculate distance using Turf.js (precise)
      const fromPoint = turf.point([latlng.lng, latlng.lat]);
      const toPoint = turf.point([markerLatLng.lng, markerLatLng.lat]);
      const distance = turf.distance(fromPoint, toPoint, { units: 'meters' });

      if (distance < SNAP_THRESHOLD_METERS && distance < minDistance) {
        minDistance = distance;
        closestLatLng = markerLatLng;
      }
    }
  });

  if (minDistance !== Infinity) {
    logConsole(`Snapping vertex to asset node (Offset: ${minDistance.toFixed(1)}m)`, 'info');
  }

  return closestLatLng;
};

// ==========================================
// POINT CREATION
// ==========================================
const startDrawPoint = () => {
  cancelActiveDrawing();
  drawingMode = 'point';
  document.getElementById('draw-control-panel').style.display = 'block';
  document.getElementById('draw-instruction').textContent = 'Click on map to place node. (Hold Shift to snap)';
  
  // Load asset sub-types
  const select = document.getElementById('draw-subtype');
  select.innerHTML = `
    <option value="pole">Pole</option>
    <option value="manhole">Manhole/Chamber</option>
    <option value="olt">OLT (Central Hub)</option>
    <option value="cabinet">Cabinet (FDH)</option>
    <option value="joint_closure">Joint Closure</option>
    <option value="splitter">Splitter Box</option>
    <option value="customer">Customer Premise</option>
    <option value="tower">Telecom Tower</option>
  `;

  document.getElementById('draw-point-btn').classList.add('active');
  map.getContainer().style.cursor = 'crosshair';
  
  map.on('click', handleMapClickDrawPoint);
};

const handleMapClickDrawPoint = (e) => {
  const snappedLatLng = getSnappedLatLng(e.latlng);

  if (tempDrawLayer) {
    map.removeLayer(tempDrawLayer);
  }

  // Create temporary marker indicating where it will be placed
  const type = document.getElementById('draw-subtype').value;
  const icon = assetIcons[type] || assetIcons.pole;
  
  tempDrawLayer = L.marker(snappedLatLng, { icon }).addTo(map);
  tempDrawLayer.properties = {
    name: 'New Node',
    asset_type: type,
    status: 'Planned'
  };

  document.getElementById('draw-save-btn').disabled = false;
  logConsole(`Click coordinate captured: [${snappedLatLng.lat.toFixed(6)}, ${snappedLatLng.lng.toFixed(6)}]. Click Save to confirm.`, 'info');
};

// ==========================================
// LINE CREATION (CABLES & DUCTS)
// ==========================================
const startDrawLine = () => {
  cancelActiveDrawing();
  drawingMode = 'line';
  activeDrawPoints = [];
  document.getElementById('draw-control-panel').style.display = 'block';
  document.getElementById('draw-instruction').textContent = 'Left click to add vertices. Double-click map to finish. (Snapping active)';
  
  const select = document.getElementById('draw-subtype');
  select.innerHTML = `
    <option value="fiber_cable">Fiber Cable Route</option>
    <option value="duct">Duct Route</option>
  `;

  document.getElementById('draw-line-btn').classList.add('active');
  map.getContainer().style.cursor = 'crosshair';

  // Setup temporary polyline
  tempDrawLayer = L.polyline([], routeStyles.fiber_cable).addTo(map);

  map.on('click', handleMapClickDrawLine);
  map.on('dblclick', handleMapDblClickDrawLine);
  
  // Disable double click zoom while drawing line
  map.doubleClickZoom.disable();
};

const handleMapClickDrawLine = (e) => {
  const snappedLatLng = getSnappedLatLng(e.latlng);
  activeDrawPoints.push(snappedLatLng);
  
  const type = document.getElementById('draw-subtype').value;
  tempDrawLayer.setLatLngs(activeDrawPoints);
  tempDrawLayer.setStyle(routeStyles[type] || routeStyles.fiber_cable);

  if (activeDrawPoints.length >= 2) {
    document.getElementById('draw-save-btn').disabled = false;
  }

  logConsole(`Vertex ${activeDrawPoints.length} added.`, 'info');
};

const handleMapDblClickDrawLine = (e) => {
  // Double-clicking adds a final vertex and triggers validation
  if (activeDrawPoints.length < 2) {
    cancelActiveDrawing();
    return;
  }
  
  // Save route
  saveDrawnFeature();
};

// ==========================================
// SPLITTING & MERGING TRIGGERS
// ==========================================
const triggerLineSplit = (routeId) => {
  cancelActiveDrawing();
  drawingMode = 'split';
  document.getElementById('draw-control-panel').style.display = 'block';
  document.getElementById('draw-instruction').textContent = 'Click exactly on the selected cable segment where you want to cut it.';
  document.getElementById('draw-subtype').innerHTML = '<option value="">Splitting segment...</option>';
  document.getElementById('draw-save-btn').disabled = true;

  map.getContainer().style.cursor = 'cut';

  // We find the selected polyline
  const polyline = leafletLayers.route[routeId];
  if (!polyline) return;

  map.on('click', async (e) => {
    // Project click point to line using turf to find closest segment coordinate
    const lineGeoJSON = polyline.toGeoJSON();
    const clickPoint = turf.point([e.latlng.lng, e.latlng.lat]);
    const snapped = turf.nearestPointOnLine(lineGeoJSON, clickPoint);

    const splitCoords = snapped.geometry.coordinates; // [lng, lat]
    logConsole(`Target split coordinates calculated: [${splitCoords[1].toFixed(6)}, ${splitCoords[0].toFixed(6)}]`, 'info');

    if (confirm('Confirm split: This will cut the selected fiber route into two separate line strings under a database transaction.')) {
      try {
        const payload = {
          routeId,
          splitPoint: {
            type: 'Point',
            coordinates: splitCoords
          }
        };
        const result = await API.gis.splitRoute(payload.routeId, payload.splitPoint);
        logConsole(result.message, 'success');
        
        // Reload all map components
        await reloadGISLayers();
        cancelActiveDrawing();
      } catch (err) {
        logConsole('Split operation aborted: ' + err.message, 'error');
      }
    } else {
      cancelActiveDrawing();
    }
  });
};

const triggerLineMerge = (routeId1) => {
  cancelActiveDrawing();
  drawingMode = 'merge';
  document.getElementById('draw-control-panel').style.display = 'block';
  document.getElementById('draw-instruction').textContent = 'Click on the adjoining cable segment you want to merge with this one.';
  document.getElementById('draw-subtype').innerHTML = '<option value="">Merging segments...</option>';
  document.getElementById('draw-save-btn').disabled = true;

  map.getContainer().style.cursor = 'copy';

  // Highlight touching route segments visually on hover or click
  Object.keys(leafletLayers.route).forEach(id => {
    const route = leafletLayers.route[id];
    if (id !== routeId1.toString()) {
      route.once('click', async (e) => {
        L.DomEvent.stopPropagation(e);
        const routeId2 = id;
        
        if (confirm(`Confirm merge: This will join cable route #${routeId1} and route #${routeId2} into a single route entity.`)) {
          try {
            const result = await API.gis.mergeRoutes(routeId1, routeId2);
            logConsole(`Cables merged successfully into segment ID ${result.properties.id}.`, 'success');
            await reloadGISLayers();
            cancelActiveDrawing();
          } catch (err) {
            logConsole('Merge failed: ' + err.message, 'error');
            cancelActiveDrawing();
          }
        } else {
          cancelActiveDrawing();
        }
      });
    }
  });
};

// ==========================================
// DRAG-MOVE POINT & VERTEX EDITING HANDLERS
// ==========================================
const enablePointDraggability = (marker) => {
  marker.dragging.enable();
  
  marker.on('dragend', async (e) => {
    const newLatLng = marker.getLatLng();
    const id = marker.properties.id;

    if (confirm(`Move asset: Do you want to commit the new position [Lat: ${newLatLng.lat.toFixed(6)}, Lng: ${newLatLng.lng.toFixed(6)}] to database?`)) {
      try {
        const payload = {
          name: marker.properties.name,
          geometry: {
            type: 'Point',
            coordinates: [newLatLng.lng, newLatLng.lat]
          }
        };
        const updated = await API.gis.updateAsset(id, payload);
        logConsole(`Asset "${updated.properties.name}" coordinates moved successfully.`, 'success');
        
        // Update local object properties
        marker.properties = updated.properties;
        marker.geometry = updated.geometry;
        
        // Re-splice connections logic since nodes moved
        await loadHistory();
      } catch (err) {
        logConsole('Failed to move asset: ' + err.message, 'error');
        // Revert geometry representation on map
        await reloadGISLayers();
      }
    } else {
      // Revert geometry changes
      await reloadGISLayers();
    }
  });
};

// ==========================================
// SAVE & CANCEL HANDLERS
// ==========================================
const saveDrawnFeature = async () => {
  if (!tempDrawLayer) return;

  const nameInput = prompt('Enter a name for the new telecom asset:', tempDrawLayer.properties ? tempDrawLayer.properties.name : 'New Route');
  if (nameInput === null) {
    cancelActiveDrawing();
    return;
  }
  const name = nameInput.trim() || 'Unnamed Asset';

  try {
    const subtype = document.getElementById('draw-subtype').value;
    
    if (drawingMode === 'point') {
      const latlng = tempDrawLayer.getLatLng();
      const payload = {
        name,
        asset_type: subtype,
        geometry: {
          type: 'Point',
          coordinates: [latlng.lng, latlng.lat]
        },
        status: 'Planned'
      };

      const result = await API.gis.createAsset(payload);
      logConsole(`Point asset "${result.properties.name}" created.`, 'success');
    } 
    else if (drawingMode === 'line') {
      // GeoJSON LineStrings need coordinate array [lng, lat]
      const geojsonCoordinates = activeDrawPoints.map(p => [p.lng, p.lat]);
      const payload = {
        name,
        route_type: subtype,
        geometry: {
          type: 'LineString',
          coordinates: geojsonCoordinates
        },
        status: 'Planned'
      };

      const result = await API.gis.createRoute(payload);
      logConsole(`Line segment "${result.properties.name}" established (Length: ${result.properties.length_meters.toFixed(1)}m).`, 'success');
    }

    // Refresh map layout
    await reloadGISLayers();
    await loadHistory();
    cancelActiveDrawing();
  } catch (err) {
    logConsole('Failed to write spatial feature: ' + err.message, 'error');
  }
};

const cancelActiveDrawing = () => {
  if (tempDrawLayer) {
    map.removeLayer(tempDrawLayer);
  }
  
  // Re-enable double click zoom
  if (map) {
    map.doubleClickZoom.enable();
    map.off('click');
    map.off('dblclick');
    map.getContainer().style.cursor = 'default';
  }

  // Clear merge click event listeners on other routes
  Object.keys(leafletLayers.route).forEach(id => {
    const route = leafletLayers.route[id];
    route.off('click');
  });

  drawingMode = null;
  tempDrawLayer = null;
  activeDrawPoints = [];

  document.getElementById('draw-control-panel').style.display = 'none';
  document.getElementById('draw-point-btn').classList.remove('active');
  document.getElementById('draw-line-btn').classList.remove('active');
  document.getElementById('draw-save-btn').disabled = true;
};
