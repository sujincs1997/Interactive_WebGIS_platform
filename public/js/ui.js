/**
 * Telecom GIS Dashboard UI Controller
 */

// ==========================================
// SYSTEM BOOT & AUTHENTICATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  initAuthUI();
  
  // If token is already present, verify it and bootstrap app
  const token = localStorage.getItem('token');
  if (token) {
    try {
      const user = await API.auth.getMe();
      bootstrapApp(user);
    } catch (e) {
      logConsole('Session expired. Please log in again.', 'warn');
      API.auth.logout();
      showAuthScreen();
    }
  } else {
    showAuthScreen();
  }
});

const showAuthScreen = () => {
  document.getElementById('auth-modal').style.display = 'flex';
  document.getElementById('dashboard').style.display = 'none';
};

const initAuthUI = () => {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const showRegister = document.getElementById('show-register');
  const showLogin = document.getElementById('show-login');
  const forgotForm = document.getElementById('forgot-form');
  const showForgot = document.getElementById('show-forgot');

  showRegister.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
  });

  showLogin.addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.style.display = 'none';
    loginForm.style.display = 'block';
  });

  // Show forgot password form
  showForgot.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.style.display = 'none';
    forgotForm.style.display = 'block';
  });

  // Login handler
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userOrEmail = document.getElementById('login-username').value;
    const pass = document.getElementById('login-password').value;
    
    try {
      const result = await API.auth.login(userOrEmail, pass);
      logConsole(`Welcome back, ${result.user.username}! Secure connection established to PostGIS database.`, 'success');
      bootstrapApp(result.user);
    } catch (err) {
      alert('Login failed: ' + err.message);
    }
  });

  // Register handler
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('reg-username').value;
    const email = document.getElementById('reg-email').value;
    const pass = document.getElementById('reg-password').value;

    try {
      const result = await API.auth.register(user, email, pass);
      logConsole(`Account registered successfully. Welcome to FiberOptix GIS, ${result.user.username}!`, 'success');
      bootstrapApp(result.user);
    } catch (err) {
      alert('Registration failed: ' + err.message);
    }
  });

  // Logout handler
  document.getElementById('logout-btn').addEventListener('click', () => {
    API.auth.logout();
    showAuthScreen();
    logConsole('User logged out. Session terminated.', 'info');
  });

  // Forgot password handler
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value;
    try {
      const res = await API.auth.forgotPassword(email);
      alert(res.message || 'If the email exists, a reset link has been sent.');
      // Switch back to login view
      forgotForm.style.display = 'none';
      document.getElementById('login-form').style.display = 'block';
    } catch (err) {
      alert('Failed to request password reset: ' + err.message);
    }
  });

  // Back to login handler
  const backLogin = document.getElementById('back-to-login-from-forgot');
  backLogin.addEventListener('click', (e) => {
    e.preventDefault();
    forgotForm.style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
  });
};

const bootstrapApp = (user) => {
  document.getElementById('auth-modal').style.display = 'none';
  document.getElementById('dashboard').style.display = 'flex';
  document.getElementById('user-display').textContent = user.username;

  // Initialize Map
  initMap();
  
  // Load Map layers
  reloadGISLayers();

  // Initialize Drawing toolbar
  document.getElementById('draw-point-btn').addEventListener('click', startDrawPoint);
  document.getElementById('draw-line-btn').addEventListener('click', startDrawLine);
  document.getElementById('draw-save-btn').addEventListener('click', saveDrawnFeature);
  document.getElementById('draw-cancel-btn').addEventListener('click', cancelActiveDrawing);

  // Initialize Layer switches
  initLayerToggles();

  // Initialize Bottom Console Tab controls
  initConsoleControls();

  // Initialize Sidebar details panel
  initFeatureDetailsForm();

  // Initialize Search Panel
  initSearch();

  // Initialize Import/Export controllers
  initImportExport();

  // Initialize Tracing controls
  initTracingControls();

  // Load bottom history lists
  loadHistory();
  loadUtilization();

  // Setup Keyboard Shortcuts
  initKeyboardShortcuts();
};

// ==========================================
// DYNAMIC CONSOLE & HISTORY LOGS
// ==========================================
const logConsole = (message, level = 'info') => {
  const list = document.getElementById('console-logs-list');
  const row = document.createElement('div');
  row.className = `log-row ${level}`;
  
  const time = new Date().toLocaleTimeString();
  row.innerHTML = `[${time}] ${message}`;
  
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
};

const initConsoleControls = () => {
  // Collapsible toggle
  const panel = document.getElementById('bottom-panel');
  const toggleBtn = document.getElementById('panel-toggle-btn');
  
  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    if (panel.classList.contains('collapsed')) {
      toggleBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
    } else {
      toggleBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
    }
  });

  // Tab controls
  document.querySelectorAll('.panel-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelector('.panel-tab-btn.active').classList.remove('active');
      document.querySelector('.panel-tab-content.active').classList.remove('active');

      const tabId = e.target.getAttribute('data-tab');
      e.target.classList.add('active');
      document.getElementById(tabId).classList.add('active');

      if (tabId === 'history-tab') {
        loadHistory();
      } else if (tabId === 'utilization-tab') {
        loadUtilization();
      }
    });
  });

  // Undo button trigger
  document.getElementById('undo-btn').addEventListener('click', async () => {
    try {
      const res = await API.gis.undo();
      logConsole(res.message, 'success');
      
      // Reload map and panels
      await reloadGISLayers();
      await loadHistory();
      await loadUtilization();
      clearSelection();
    } catch (err) {
      logConsole('Undo failed: ' + err.message, 'error');
    }
  });
};

const loadHistory = async () => {
  try {
    const list = await API.gis.getHistory();
    const tbody = document.getElementById('history-rows');
    tbody.innerHTML = '';

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No edits logged in audit trail yet.</td></tr>';
      return;
    }

    list.forEach(row => {
      const tr = document.createElement('tr');
      const time = new Date(row.changed_at).toLocaleString();
      tr.innerHTML = `
        <td>${time}</td>
        <td><strong>${row.username || 'System'}</strong></td>
        <td><span class="log-badge ${row.action.toLowerCase()}">${row.action}</span></td>
        <td>${row.table_name.replace('telecom_', '').toUpperCase()}</td>
        <td>#${row.record_id}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('History load failed:', err);
  }
};

const loadUtilization = async () => {
  try {
    const list = await API.trace.utilization();
    const grid = document.getElementById('utilization-grid');
    grid.innerHTML = '';

    if (list.length === 0) {
      grid.innerHTML = '<div class="empty-state">No active fiber cable routes available.</div>';
      return;
    }

    list.forEach(item => {
      const card = document.createElement('div');
      card.className = 'metric-card';
      
      let utilColor = 'var(--success-color)';
      if (item.utilizationPercent > 80) utilColor = 'var(--danger-color)';
      else if (item.utilizationPercent > 50) utilColor = 'var(--warning-color)';

      card.innerHTML = `
        <h4>#${item.id} - ${item.name}</h4>
        <p>${item.activeFibers} / ${item.totalFibers} cores</p>
        <div class="util-bar-wrapper" style="background: rgba(255,255,255,0.05); height: 6px; border-radius: 3px; overflow: hidden; margin-top: 8px;">
          <div class="util-bar" style="background: ${utilColor}; width: ${item.utilizationPercent}%; height: 100%;"></div>
        </div>
        <span style="font-size: 11px; color: var(--text-muted); margin-top: 4px; display: block;">Usage: ${item.utilizationPercent}% (Length: ${item.lengthMeters.toFixed(0)}m)</span>
      `;
      grid.appendChild(card);
    });
  } catch (err) {
    console.error('Utilization load failed:', err);
  }
};

// ==========================================
// LAYER CONFIGS
// ==========================================
const initLayerToggles = () => {
  const bindToggle = (chkId, layerGroup) => {
    document.getElementById(chkId).addEventListener('change', (e) => {
      if (e.target.checked) {
        map.addLayer(layerGroup);
      } else {
        map.removeLayer(layerGroup);
      }
    });
  };

  bindToggle('layer-olt', mapLayers.olt);
  bindToggle('layer-cabinet', mapLayers.cabinet);
  bindToggle('layer-joint', mapLayers.joint_closure);
  bindToggle('layer-splitter', mapLayers.splitter);
  bindToggle('layer-pole', mapLayers.pole);
  bindToggle('layer-customer', mapLayers.customer);
  bindToggle('layer-fiber', mapLayers.fiber_cable);
  bindToggle('layer-duct', mapLayers.duct);
};

// ==========================================
// SEARCH TOOL
// ==========================================
const initSearch = () => {
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  const resultsDiv = document.getElementById('search-results');

  searchInput.addEventListener('keyup', (e) => {
    const val = e.target.value.trim().toLowerCase();
    
    if (!val) {
      searchClear.style.display = 'none';
      resultsDiv.style.display = 'none';
      return;
    }

    searchClear.style.display = 'block';
    resultsDiv.style.display = 'block';
    resultsDiv.innerHTML = '';

    const matches = [];

    // Filter points
    Object.keys(leafletLayers.asset).forEach(id => {
      const props = leafletLayers.asset[id].properties;
      if (props.name.toLowerCase().includes(val) || props.asset_type.toLowerCase().includes(val)) {
        matches.push({ id, name: props.name, type: 'asset', category: props.asset_type });
      }
    });

    // Filter routes
    Object.keys(leafletLayers.route).forEach(id => {
      const props = leafletLayers.route[id].properties;
      if (props.name.toLowerCase().includes(val) || props.route_type.toLowerCase().includes(val)) {
        matches.push({ id, name: props.name, type: 'route', category: props.route_type });
      }
    });

    if (matches.length === 0) {
      resultsDiv.innerHTML = '<div style="padding: 10px; font-style: italic; font-size: 12px; color: var(--text-muted);">No matching features found.</div>';
      return;
    }

    // Render matches
    matches.slice(0, 10).forEach(match => {
      const row = document.createElement('div');
      row.className = 'search-result-item';
      row.innerHTML = `
        <span><strong>${match.name}</strong></span>
        <span style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">${match.category}</span>
      `;
      row.addEventListener('click', () => {
        const layerInstance = leafletLayers[match.type][match.id];
        selectFeature(match.id, match.type, layerInstance);
        zoomToFeature(layerInstance.geometry);
        resultsDiv.style.display = 'none';
      });
      resultsDiv.appendChild(row);
    });
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    resultsDiv.style.display = 'none';
  });
};

// ==========================================
// FEATURE EDIT FORM HANDLERS
// ==========================================
const initFeatureDetailsForm = () => {
  const form = document.getElementById('attribute-form');
  const deleteBtn = document.getElementById('delete-feature-btn');

  // Submit/Save attributes
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('attr-id').value;
    const layerType = document.getElementById('attr-layer-type').value;

    const payload = {
      name: document.getElementById('attr-name').value,
      status: document.getElementById('attr-status').value,
      owner: document.getElementById('attr-owner').value,
      remarks: document.getElementById('attr-remarks').value,
    };

    // Gather dynamic custom attributes
    const dynamicBox = document.getElementById('dynamic-attributes-box');
    dynamicBox.querySelectorAll('.dynamic-input-row').forEach(row => {
      const key = row.getAttribute('data-key');
      const val = row.querySelector('.dynamic-value').value;
      payload[key] = isNaN(val) || val === '' ? val : parseFloat(val);
    });

    try {
      let updated;
      if (layerType === 'asset') {
        updated = await API.gis.updateAsset(id, payload);
        leafletLayers.asset[id].properties = updated.properties;
      } else {
        updated = await API.gis.updateRoute(id, payload);
        leafletLayers.route[id].properties = updated.properties;
      }

      logConsole(`Attributes saved successfully for ID ${id}.`, 'success');
      
      // Reload panels
      await loadHistory();
      await loadUtilization();
      selectFeature(id, layerType, leafletLayers[layerType][id]);
    } catch (err) {
      logConsole('Failed to update properties: ' + err.message, 'error');
    }
  });

  // Delete handler
  deleteBtn.addEventListener('click', async () => {
    const id = document.getElementById('attr-id').value;
    const layerType = document.getElementById('attr-layer-type').value;

    if (confirm(`Confirm deletion: Are you sure you want to delete ${layerType === 'asset' ? 'Asset' : 'Cable Route'} #${id}? Splicing associations will be cleaned.`)) {
      try {
        if (layerType === 'asset') {
          await API.gis.deleteAsset(id);
        } else {
          await API.gis.deleteRoute(id);
        }

        logConsole(`Feature #${id} removed successfully (soft-delete registered).`, 'success');
        
        // Remove from map dynamically
        clearSelection();
        await reloadGISLayers();
        await loadHistory();
        await loadUtilization();
      } catch (err) {
        logConsole('Failed to delete feature: ' + err.message, 'error');
      }
    }
  });

  // Link Builder button Splicing
  document.getElementById('add-link-btn').addEventListener('click', async () => {
    const fromId = document.getElementById('attr-id').value;
    const toId = document.getElementById('link-target-select').value;
    const routeId = document.getElementById('link-route-select').value;
    const linkType = document.getElementById('link-type-select').value;

    if (!toId) {
      alert('Please choose a target equipment to splice into.');
      return;
    }

    try {
      const link = await API.trace.createLink({
        from_asset_id: parseInt(fromId),
        to_asset_id: parseInt(toId),
        route_id: routeId ? parseInt(routeId) : null,
        link_type: linkType
      });

      logConsole(`Assets successfully spliced in topology index. Link ID: #${link.id}.`, 'success');
      
      // Reload details to display newly added splicing row
      selectFeature(fromId, 'asset', leafletLayers.asset[fromId]);
      await loadHistory();
    } catch (err) {
      logConsole('Splicing failed: ' + err.message, 'error');
    }
  });

  // Line Splitting & Merging
  document.getElementById('split-line-btn').addEventListener('click', () => {
    const id = document.getElementById('attr-id').value;
    triggerLineSplit(id);
  });
  
  document.getElementById('merge-line-btn').addEventListener('click', () => {
    const id = document.getElementById('attr-id').value;
    triggerLineMerge(id);
  });
};

const loadFeatureDetails = async (props, type) => {
  document.getElementById('no-feature-selected').style.display = 'none';
  document.getElementById('feature-details-container').style.display = 'block';

  document.getElementById('attr-id').value = props.id;
  document.getElementById('attr-layer-type').value = type;
  document.getElementById('attr-name').value = props.name;
  document.getElementById('attr-type').value = type === 'asset' ? props.asset_type.toUpperCase() : props.route_type.toUpperCase();
  document.getElementById('attr-status').value = props.status;
  document.getElementById('attr-owner').value = props.owner || 'Company';
  document.getElementById('attr-remarks').value = props.remarks || '';

  // Handle route length indicators
  if (type === 'route') {
    document.getElementById('route-length-group').style.display = 'block';
    document.getElementById('attr-length').value = `${props.length_meters.toFixed(1)} meters`;
    document.getElementById('connectivity-section').style.display = 'none';
    document.getElementById('line-operations-section').style.display = 'block';
  } else {
    document.getElementById('route-length-group').style.display = 'none';
    document.getElementById('connectivity-section').style.display = 'block';
    document.getElementById('line-operations-section').style.display = 'none';

    // Enable draggability for editing point geometry
    const marker = leafletLayers.asset[props.id];
    enablePointDraggability(marker);

    // Render Splicing linkages lists
    await populateConnectivityTopology(props.id);
  }

  // Generate dynamic type-specific parameter rows
  renderDynamicAttributes(props, type);
};

const hideFeatureDetails = () => {
  document.getElementById('no-feature-selected').style.display = 'flex';
  document.getElementById('feature-details-container').style.display = 'none';
};

const renderDynamicAttributes = (props, type) => {
  const box = document.getElementById('dynamic-attributes-box');
  box.innerHTML = '';

  const sub = type === 'asset' ? props.asset_type : props.route_type;

  let fields = [];
  if (sub === 'fiber_cable') {
    fields = [
      { label: 'Fiber Core Count', key: 'fiber_count', type: 'select', options: [12, 24, 48, 96, 144, 288], default: 24 },
      { label: 'Cable Type', key: 'cable_type', type: 'select', options: ['Loose Tube', 'Ribbon', 'Armored', 'Drop'], default: 'Loose Tube' }
    ];
  } else if (sub === 'splitter') {
    fields = [
      { label: 'Splitter Ratio', key: 'splitter_ratio', type: 'select', options: ['1:2', '1:4', '1:8', '1:16', '1:32', '1:64'], default: '1:8' }
    ];
  } else if (sub === 'cabinet') {
    fields = [
      { label: 'Capacity (slots)', key: 'cabinet_slots', type: 'number', default: 12 }
    ];
  } else if (sub === 'pole' || sub === 'manhole') {
    fields = [
      { label: 'Structure Material', key: 'material', type: 'select', options: ['Wood', 'Concrete', 'Steel', 'Composite'], default: 'Concrete' }
    ];
  } else if (sub === 'customer') {
    fields = [
      { label: 'Customer Account #', key: 'account_number', type: 'text', default: 'ONT-000' },
      { label: 'SLA Tier', key: 'sla_tier', type: 'select', options: ['Residential', 'Business Gold', 'Enterprise Dedicated'], default: 'Residential' }
    ];
  }

  if (fields.length === 0) return;

  const title = document.createElement('h5');
  title.textContent = 'Telecom Specifications';
  title.style.margin = '12px 0 8px 0';
  title.style.fontSize = '12px';
  title.style.color = 'var(--text-muted)';
  box.appendChild(title);

  fields.forEach(f => {
    const grp = document.createElement('div');
    grp.className = 'form-group dynamic-input-row';
    grp.setAttribute('data-key', f.key);

    const lbl = document.createElement('label');
    lbl.textContent = f.label;
    grp.appendChild(lbl);

    const val = props[f.key] !== undefined ? props[f.key] : f.default;

    if (f.type === 'select') {
      const select = document.createElement('select');
      select.className = 'input-select dynamic-value';
      f.options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        if (opt.toString() === val.toString()) option.selected = true;
        select.appendChild(option);
      });
      grp.appendChild(select);
    } else {
      const input = document.createElement('input');
      input.type = f.type === 'number' ? 'number' : 'text';
      input.className = 'input-text dynamic-value';
      input.value = val;
      grp.appendChild(input);
    }

    box.appendChild(grp);
  });
};

const populateConnectivityTopology = async (assetId) => {
  try {
    const links = await API.trace.getLinks();
    
    // 1. Render currently established splicing links for this asset
    const listDiv = document.getElementById('topology-list');
    listDiv.innerHTML = '';
    
    const activeLinks = links.filter(l => l.from_asset_id === parseInt(assetId) || l.to_asset_id === parseInt(assetId));
    
    if (activeLinks.length === 0) {
      listDiv.innerHTML = '<div class="empty-state" style="padding: 10px;">No splicing links mapped in PostGIS topology.</div>';
    } else {
      activeLinks.forEach(link => {
        const row = document.createElement('div');
        row.className = 'conn-link-row';
        const partner = link.from_asset_id === parseInt(assetId) ? link.to_asset_name : link.from_asset_name;
        
        row.innerHTML = `
          <span><strong>${link.link_type.replace('-', ' → ').toUpperCase()}</strong><br><small style="color: var(--text-muted)">Partner: ${partner}</small></span>
          <button class="remove-link-btn" title="Remove splice splice line" onclick="deleteSpliceLink(${link.id}, ${assetId})">
            <i class="fa-solid fa-circle-minus"></i>
          </button>
        `;
        listDiv.appendChild(row);
      });
    }

    // 2. Populate Target dropdown selections with point assets
    const targetSelect = document.getElementById('link-target-select');
    targetSelect.innerHTML = '<option value="">-- Choose asset from map --</option>';
    
    Object.keys(leafletLayers.asset).forEach(id => {
      if (id !== assetId.toString()) {
        const props = leafletLayers.asset[id].properties;
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = `${props.name} (${props.asset_type.toUpperCase()})`;
        targetSelect.appendChild(opt);
      }
    });

    // 3. Populate Cable dropdown selections with routes
    const routeSelect = document.getElementById('link-route-select');
    routeSelect.innerHTML = '<option value="">-- Direct Splice / Unmapped --</option>';
    
    Object.keys(leafletLayers.route).forEach(id => {
      const props = leafletLayers.route[id].properties;
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${props.name} (Length: ${props.length_meters.toFixed(0)}m)`;
      routeSelect.appendChild(opt);
    });

  } catch (err) {
    console.error('Failed to populate connectivity topology UI:', err);
  }
};

// Global scope helper since dynamically rendered string calls it
window.deleteSpliceLink = async (linkId, assetId) => {
  if (confirm('Disconnect: Are you sure you want to remove this splice splice connection?')) {
    try {
      await API.trace.deleteLink(linkId);
      logConsole(`Splice link #${linkId} disconnected.`, 'success');
      await populateConnectivityTopology(assetId);
      await loadHistory();
    } catch (err) {
      logConsole('Disconnection failed: ' + err.message, 'error');
    }
  }
};

// ==========================================
// TRACING TRIGGERS
// ==========================================
const initTracingControls = () => {
  const select = document.getElementById('trace-type-select');
  const triggerBox = document.getElementById('trace-trigger-box');
  const runBtn = document.getElementById('run-trace-btn');
  const clearBtn = document.getElementById('clear-trace-btn');

  select.addEventListener('change', (e) => {
    const val = e.target.value;
    clearTraceHighlights();

    // Toggle guidance boxes
    if (val === 'shortest') {
      triggerBox.innerHTML = `
        <div id="shortest-path-inputs">
          <div class="form-group">
            <label>Start Node (Source):</label>
            <input type="text" id="shortest-start-id" placeholder="Choose asset 1" readonly style="background: rgba(255,255,255,0.05);">
            <button class="btn btn-small btn-secondary" onclick="setShortestSourceTarget('start')" style="margin-top: 4px; padding: 2px 8px; font-size: 11px;">Set Active</button>
          </div>
          <div class="form-group">
            <label>End Node (Sink):</label>
            <input type="text" id="shortest-end-id" placeholder="Choose asset 2" readonly style="background: rgba(255,255,255,0.05);">
            <button class="btn btn-small btn-secondary" onclick="setShortestSourceTarget('end')" style="margin-top: 4px; padding: 2px 8px; font-size: 11px;">Set Active</button>
          </div>
        </div>
      `;
      traceStartNodeId = null;
      traceEndNodeId = null;
    } else if (val === 'impact') {
      triggerBox.innerHTML = '<p>Click on any line (cable) or hub node, then run analysis to trace all customer premises affected by the failure.</p>';
    } else if (val === 'upstream') {
      triggerBox.innerHTML = '<p>Traces path backwards from active customer premises/splitter towards the feeding OLT source hubs.</p>';
    } else if (val === 'downstream') {
      triggerBox.innerHTML = '<p>Traces feed outputs forward from OLTs to identify splitters and customer ONTs connected to it.</p>';
    } else if (val === 'full') {
      triggerBox.innerHTML = '<p>BFS graph query returning all equipment connected to the selected network component.</p>';
    }
  });

  runBtn.addEventListener('click', executeNetworkAnalysis);
  clearBtn.addEventListener('click', clearTraceHighlights);
};

// Global scope helpers for shortest path selection
window.setShortestSourceTarget = (role) => {
  if (!selectedFeature || selectedFeature.type !== 'asset') {
    alert('Please click on a point node asset on the map first, then click set.');
    return;
  }

  const id = selectedFeature.id;
  const name = selectedFeature.layer.properties.name;

  if (role === 'start') {
    traceStartNodeId = id;
    document.getElementById('shortest-start-id').value = `${name} (#${id})`;
    logConsole(`Shortest path origin registered: Node ID ${id}`, 'info');
  } else {
    traceEndNodeId = id;
    document.getElementById('shortest-end-id').value = `${name} (#${id})`;
    logConsole(`Shortest path destination registered: Node ID ${id}`, 'info');
  }
};

// ==========================================
// KEYBOARD SHORTCUTS
// ==========================================
const initKeyboardShortcuts = () => {
  window.addEventListener('keydown', (e) => {
    // Undo: Ctrl+Z
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      document.getElementById('undo-btn').click();
    }
    // Cancel drawing: Escape
    if (e.key === 'Escape') {
      if (isDrawingActive()) {
        cancelActiveDrawing();
        logConsole('Active editing operation cancelled via ESC key.', 'warn');
      } else {
        clearSelection();
      }
    }
  });
};
