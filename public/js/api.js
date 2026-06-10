const API_BASE = '/api';

/**
 * Global API Request Wrapper containing authentication injections.
 */
const request = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  
  // Set default headers
  const headers = {
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // If body is not FormData (e.g. for imports), set application/json
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errMsg = `Request failed: ${response.statusText}`;
    try {
      const data = await response.json();
      errMsg = data.message || errMsg;
    } catch (e) {}
    throw new Error(errMsg);
  }

  // Handle blob responses (for exporting files)
  const contentType = response.headers.get('Content-Type');
  if (contentType && (contentType.includes('text/csv') || contentType.includes('application/vnd.google-earth') || contentType.includes('application/json') && response.headers.get('Content-Disposition'))) {
    return await response.blob();
  }

  return await response.json();
};

const API = {
  // ==========================================
  // AUTHENTICATION
  // ==========================================
  auth: {
    login: async (usernameOrEmail, password) => {
      const data = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ usernameOrEmail, password }),
      });
      if (data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
      }
      return data;
    },
    register: async (username, email, password) => {
      const data = await request('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, password }),
      });
      if (data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
      }
      return data;
    },
    getMe: async () => {
      return await request('/auth/me');
    },
    logout: () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    },
    forgotPassword: async (email) => {
      const data = await request('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      return data;
    }
  },


  // ==========================================
  // GIS ASSETS (POINTS) & ROUTES (LINES)
  // ==========================================
  gis: {
    getAssets: async () => {
      return await request('/gis/assets');
    },
    createAsset: async (assetData) => {
      return await request('/gis/assets', {
        method: 'POST',
        body: JSON.stringify(assetData),
      });
    },
    updateAsset: async (id, assetData) => {
      return await request(`/gis/assets/${id}`, {
        method: 'PUT',
        body: JSON.stringify(assetData),
      });
    },
    deleteAsset: async (id) => {
      return await request(`/gis/assets/${id}`, {
        method: 'DELETE',
      });
    },
    recoverAsset: async (id) => {
      return await request(`/gis/assets/${id}/recover`, {
        method: 'POST',
      });
    },

    getRoutes: async () => {
      return await request('/gis/routes');
    },
    createRoute: async (routeData) => {
      return await request('/gis/routes', {
        method: 'POST',
        body: JSON.stringify(routeData),
      });
    },
    updateRoute: async (id, routeData) => {
      return await request(`/gis/routes/${id}`, {
        method: 'PUT',
        body: JSON.stringify(routeData),
      });
    },
    deleteRoute: async (id) => {
      return await request(`/gis/routes/${id}`, {
        method: 'DELETE',
      });
    },
    recoverRoute: async (id) => {
      return await request(`/gis/routes/${id}/recover`, {
        method: 'POST',
      });
    },

    // Advanced Splitting & Merging
    splitRoute: async (routeId, splitPoint) => {
      return await request('/gis/routes/split', {
        method: 'POST',
        body: JSON.stringify({ routeId, splitPoint }),
      });
    },
    mergeRoutes: async (routeId1, routeId2) => {
      return await request('/gis/routes/merge', {
        method: 'POST',
        body: JSON.stringify({ routeId1, routeId2 }),
      });
    },

    // History and Undo Operations
    getHistory: async () => {
      return await request('/gis/history');
    },
    undo: async () => {
      return await request('/gis/history/undo', {
        method: 'POST',
      });
    }
  },

  // ==========================================
  // TOPOLOGY & TRACING ENGINE
  // ==========================================
  trace: {
    getLinks: async () => {
      return await request('/trace/links');
    },
    createLink: async (linkData) => {
      return await request('/trace/link', {
        method: 'POST',
        body: JSON.stringify(linkData),
      });
    },
    deleteLink: async (id) => {
      return await request(`/trace/link/${id}`, {
        method: 'DELETE',
      });
    },
    upstream: async (id) => {
      return await request(`/trace/upstream/${id}`);
    },
    downstream: async (id) => {
      return await request(`/trace/downstream/${id}`);
    },
    full: async (id) => {
      return await request(`/trace/full/${id}`);
    },
    shortestPath: async (startAssetId, endAssetId) => {
      return await request('/trace/shortest-path', {
        method: 'POST',
        body: JSON.stringify({ startAssetId, endAssetId }),
      });
    },
    serviceImpact: async (nodeType, id) => {
      return await request('/trace/service-impact', {
        method: 'POST',
        body: JSON.stringify({ nodeType, id }),
      });
    },
    utilization: async () => {
      return await request('/trace/utilization');
    }
  },

  // ==========================================
  // FILE IMPORTS & EXPORTS
  // ==========================================
  data: {
    exportGeoJSON: async () => {
      return await request('/data/export/geojson');
    },
    exportKML: async () => {
      return await request('/data/export/kml');
    },
    exportCSV: async () => {
      return await request('/data/export/csv');
    },
    importFile: async (file, format) => {
      const formData = new FormData();
      formData.append('file', file);
      return await request(`/data/import/${format}`, {
        method: 'POST',
        body: formData,
        // Let the browser handle boundary header since body is FormData
      });
    }
  }
};
