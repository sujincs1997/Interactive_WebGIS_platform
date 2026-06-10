/**
 * Leaflet Mapping Core Module
 */
let map;
let activeBasemap = 'osm';

// Feature Groups for different GIS layers
const mapLayers = {
  olt: L.featureGroup(),
  cabinet: L.featureGroup(),
  joint_closure: L.featureGroup(),
  splitter: L.featureGroup(),
  pole: L.featureGroup(),
  customer: L.featureGroup(),
  fiber_cable: L.featureGroup(),
  duct: L.featureGroup()
};

// Object to store all leaflet layer instances mapped by database IDs (useful for selection and updates)
// Format: { asset: { [id]: layer }, route: { [id]: layer } }
const leafletLayers = {
  asset: {},
  route: {}
};

// Selected feature reference { id, type: 'asset'|'route', layer }
let selectedFeature = null;

// Splicing highlights or Trace layer highlight reference
let traceHighlightGroup = L.featureGroup();

// Basemap Tile Layers
const basemaps = {
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
  }),
  terrain: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles © Esri — Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community'
  })
};

// ==========================================
// CUSTOM SVG VECTOR MARKER ICONS
// ==========================================
const createSVGIcon = (color, iconClass, label) => {
  const html = `
    <div class="custom-svg-marker" style="background-color: ${color}; box-shadow: 0 0 10px ${color}">
      <i class="${iconClass}"></i>
      ${label ? `<span class="marker-label">${label}</span>` : ''}
    </div>
  `;
  return L.divIcon({
    html,
    className: 'div-marker-wrapper',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
};

const assetIcons = {
  olt: createSVGIcon('#e040fb', 'fa-solid fa-server'),
  cabinet: createSVGIcon('#ff9100', 'fa-solid fa-box-archive'),
  joint_closure: createSVGIcon('#00e5ff', 'fa-solid fa-circle-nodes'),
  splitter: createSVGIcon('#00e676', 'fa-solid fa-code-branch'),
  pole: createSVGIcon('#90a4ae', 'fa-solid fa-map-pin'),
  manhole: createSVGIcon('#78909c', 'fa-solid fa-ring'),
  tower: createSVGIcon('#e6ee9c', 'fa-solid fa-tower-broadcast'),
  customer: createSVGIcon('#ff5252', 'fa-solid fa-house-signal'),
  ont: createSVGIcon('#ff5252', 'fa-solid fa-network-wired')
};

// Styles for fiber cables and duct routes
const routeStyles = {
  fiber_cable: {
    color: '#b388ff',
    weight: 4,
    opacity: 0.9,
    dashArray: null
  },
  duct: {
    color: '#26a69a',
    weight: 6,
    opacity: 0.7,
    dashArray: '8, 8'
  },
  highlight: {
    color: '#ffff00',
    weight: 8,
    opacity: 1.0,
    dashArray: null
  }
};

// ==========================================
// INITIALIZATION
// ==========================================
const initMap = () => {
  // Center map on a default coordinate (San Francisco/Telecom Hub coordinates)
  map = L.map('map', {
    center: [37.7749, -122.4194],
    zoom: 13,
    zoomControl: false // custom position below
  });

  // Add OSM as default basemap
  basemaps.osm.addTo(map);

  // Position standard zoom controls
  L.control.zoom({ position: 'topleft' }).addTo(map);
  
  // Position Leaflet scale bar
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

  // Add all asset feature groups to the map
  Object.values(mapLayers).forEach(group => group.addTo(map));
  traceHighlightGroup.addTo(map);

  // Map hover tracker
  map.on('mousemove', (e) => {
    const coordText = `Lat: ${e.latlng.lat.toFixed(6)}, Lng: ${e.latlng.lng.toFixed(6)}`;
    document.getElementById('coordinate-text').textContent = coordText;
  });

  // Setup Basemap selectors
  document.querySelectorAll('.basemap-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const selected = e.target.getAttribute('data-basemap');
      if (selected === activeBasemap) return;

      map.removeLayer(basemaps[activeBasemap]);
      basemaps[selected].addTo(map);
      
      document.querySelector('.basemap-btn.active').classList.remove('active');
      e.target.classList.add('active');
      activeBasemap = selected;
    });
  });

  // Handle click on map background to clear selections
  map.on('click', (e) => {
    // If not drawing, deselect active feature
    if (!isDrawingActive()) {
      clearSelection();
    }
  });
};

// ==========================================
// DATA LOADING AND RENDERING
// ==========================================

const reloadGISLayers = async () => {
  try {
    // Clear all existing items from feature groups
    Object.values(mapLayers).forEach(group => group.clearLayers());
    leafletLayers.asset = {};
    leafletLayers.route = {};
    
    // Fetch point assets
    const assetsData = await API.gis.getAssets();
    if (assetsData && assetsData.features) {
      assetsData.features.forEach(feature => {
        renderAssetOnMap(feature);
      });
    }

    // Fetch line routes
    const routesData = await API.gis.getRoutes();
    if (routesData && routesData.features) {
      routesData.features.forEach(feature => {
        renderRouteOnMap(feature);
      });
    }

    logConsole('GIS assets and cable networks loaded successfully.', 'success');
  } catch (err) {
    console.error('Error reloading map layer data:', err);
    logConsole('Failed to retrieve GIS assets from database. Config check required.', 'error');
  }
};

// Render asset points
const renderAssetOnMap = (feature) => {
  const { id, name, asset_type } = feature.properties;
  const coords = feature.geometry.coordinates;
  const latlng = [coords[1], coords[0]];

  // Pick suitable SVG vector icon
  const icon = assetIcons[asset_type] || assetIcons.pole;

  const marker = L.marker(latlng, { icon });
  marker.properties = feature.properties;
  marker.geometry = feature.geometry;

  // Bind click trigger
  marker.on('click', (e) => {
    L.DomEvent.stopPropagation(e); // prevent map background click
    selectFeature(id, 'asset', marker);
  });

  // Add to corresponding layer group
  let targetGroup = mapLayers[asset_type];
  if (!targetGroup) {
    targetGroup = mapLayers.pole;
  }
  
  targetGroup.addLayer(marker);
  leafletLayers.asset[id] = marker;
};

// Render lines (cables/ducts)
const renderRouteOnMap = (feature) => {
  const { id, name, route_type } = feature.properties;
  const coords = feature.geometry.coordinates;
  // Convert GeoJSON coords [lng, lat] to Leaflet [lat, lng]
  const latlngs = coords.map(c => [c[1], c[0]]);

  const style = routeStyles[route_type] || routeStyles.fiber_cable;

  const polyline = L.polyline(latlngs, style);
  polyline.properties = feature.properties;
  polyline.geometry = feature.geometry;

  // Bind click trigger
  polyline.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    selectFeature(id, 'route', polyline);
  });

  let targetGroup = mapLayers[route_type];
  if (!targetGroup) {
    targetGroup = mapLayers.fiber_cable;
  }

  targetGroup.addLayer(polyline);
  leafletLayers.route[id] = polyline;
};

// ==========================================
// FEATURE SELECTION & INTERACTION
// ==========================================

const selectFeature = (id, layerType, layerInstance) => {
  clearSelection();

  selectedFeature = {
    id,
    type: layerType,
    layer: layerInstance
  };

  // Visual Highlight
  if (layerType === 'route') {
    // Save original style
    layerInstance.originalStyle = {
      color: layerInstance.options.color,
      weight: layerInstance.options.weight,
      opacity: layerInstance.options.opacity,
      dashArray: layerInstance.options.dashArray
    };
    layerInstance.setStyle({
      color: '#00ffd8',
      weight: 7,
      opacity: 1.0
    });
  } else {
    // Add glowing select ring around div icon marker
    const el = layerInstance.getElement();
    if (el) {
      el.querySelector('.custom-svg-marker').style.outline = '3px solid #00ffd8';
      el.querySelector('.custom-svg-marker').style.outlineOffset = '3px';
    }
  }

  // Load right sidebar editor details
  loadFeatureDetails(layerInstance.properties, layerType);
};

const clearSelection = () => {
  if (!selectedFeature) return;

  const { type, layer } = selectedFeature;

  if (type === 'route') {
    if (layer.originalStyle) {
      layer.setStyle(layer.originalStyle);
    }
  } else {
    const el = layer.getElement();
    if (el) {
      const markerEl = el.querySelector('.custom-svg-marker');
      if (markerEl) {
        markerEl.style.outline = 'none';
      }
    }
  }

  selectedFeature = null;
  hideFeatureDetails();
};

const zoomToFeature = (geometry) => {
  if (!geometry || !geometry.coordinates) return;

  if (geometry.type === 'Point') {
    const coords = geometry.coordinates;
    map.setView([coords[1], coords[0]], 17);
  } else if (geometry.type === 'LineString') {
    const coords = geometry.coordinates;
    const latlngs = coords.map(c => [c[1], c[0]]);
    const bounds = L.latLngBounds(latlngs);
    map.fitBounds(bounds, { padding: [50, 50] });
  }
};
