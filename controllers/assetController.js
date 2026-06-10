const db = require('../config/db');

/**
 * Utility to convert DB point row to GeoJSON Feature
 */
const assetToGeoJSON = (row) => ({
  type: 'Feature',
  geometry: row.geom_json,
  properties: {
    id: row.id,
    name: row.name,
    asset_type: row.asset_type,
    status: row.status,
    owner: row.owner,
    installation_date: row.installation_date,
    remarks: row.remarks,
    is_deleted: row.is_deleted,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...row.additional_attributes
  }
});

/**
 * Utility to convert DB route row to GeoJSON Feature
 */
const routeToGeoJSON = (row) => ({
  type: 'Feature',
  geometry: row.geom_json,
  properties: {
    id: row.id,
    name: row.name,
    route_type: row.route_type,
    status: row.status,
    owner: row.owner,
    installation_date: row.installation_date,
    length_meters: parseFloat(row.length_meters || 0),
    remarks: row.remarks,
    is_deleted: row.is_deleted,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...row.additional_attributes
  }
});

// ==========================================
// ASSET CONTROLLERS (POINTS)
// ==========================================

// Get all non-deleted Assets
exports.getAssets = async (req, res) => {
  try {
    const queryStr = `
      SELECT id, name, asset_type, status, owner, installation_date, remarks, 
             additional_attributes, is_deleted, created_at, updated_at,
             ST_AsGeoJSON(geom)::json AS geom_json 
      FROM telecom_assets 
      WHERE is_deleted = false
    `;
    const result = await db.query(queryStr);
    const features = result.rows.map(assetToGeoJSON);
    res.json({
      type: 'FeatureCollection',
      features
    });
  } catch (err) {
    console.error('getAssets error:', err.message);
    res.status(500).json({ message: 'Server error retrieving assets' });
  }
};

// Create a new Asset
exports.createAsset = async (req, res) => {
  const { name, asset_type, geometry, status, owner, remarks, ...attributes } = req.body;
  const userId = req.user ? req.user.id : null;

  if (!name || !asset_type || !geometry || !geometry.coordinates) {
    return res.status(400).json({ message: 'Missing required fields (name, asset_type, geometry)' });
  }

  try {
    const newAsset = await db.transaction(async (client) => {
      // 1. Insert asset
      const geomGeoJSON = JSON.stringify(geometry);
      const insertAssetStr = `
        INSERT INTO telecom_assets 
          (name, asset_type, geom, status, owner, remarks, additional_attributes, created_by)
        VALUES 
          ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4, $5, $6, $7, $8)
        RETURNING id, name, asset_type, status, owner, installation_date, remarks,
                  additional_attributes, is_deleted, created_at, updated_at,
                  ST_AsGeoJSON(geom)::json AS geom_json
      `;
      const assetResult = await client.query(insertAssetStr, [
        name,
        asset_type,
        geomGeoJSON,
        status || 'Planned',
        owner || 'Company',
        remarks || '',
        attributes || {},
        userId
      ]);

      const asset = assetResult.rows[0];

      // 2. Log in edit_history
      const insertHistoryStr = `
        INSERT INTO edit_history (table_name, record_id, action, new_data, changed_by)
        VALUES ('telecom_assets', $1, 'INSERT', $2, $3)
      `;
      await client.query(insertHistoryStr, [asset.id, JSON.stringify(asset), userId]);

      return asset;
    });

    res.status(201).json(assetToGeoJSON(newAsset));
  } catch (err) {
    console.error('createAsset error:', err.message);
    res.status(500).json({ message: 'Server error creating asset: ' + err.message });
  }
};

// Update asset properties or geometry
exports.updateAsset = async (req, res) => {
  const { id } = req.params;
  const { name, asset_type, geometry, status, owner, remarks, ...attributes } = req.body;
  const userId = req.user ? req.user.id : null;

  try {
    const updatedAsset = await db.transaction(async (client) => {
      // 1. Get current asset data
      const getAssetStr = `
        SELECT id, name, asset_type, status, owner, installation_date, remarks, 
               additional_attributes, is_deleted, created_at, updated_at,
               ST_AsGeoJSON(geom)::json AS geom_json
        FROM telecom_assets WHERE id = $1
      `;
      const currentRes = await client.query(getAssetStr, [id]);
      if (currentRes.rows.length === 0) {
        throw new Error('Asset not found');
      }
      const oldAsset = currentRes.rows[0];

      // 2. Update asset
      let updateStr = '';
      let params = [];

      if (geometry) {
        updateStr = `
          UPDATE telecom_assets
          SET name = $1, asset_type = $2, geom = ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), 
              status = $4, owner = $5, remarks = $6, additional_attributes = $7, updated_at = CURRENT_TIMESTAMP
          WHERE id = $8
          RETURNING id, name, asset_type, status, owner, installation_date, remarks,
                    additional_attributes, is_deleted, created_at, updated_at,
                    ST_AsGeoJSON(geom)::json AS geom_json
        `;
        params = [
          name || oldAsset.name,
          asset_type || oldAsset.asset_type,
          JSON.stringify(geometry),
          status || oldAsset.status,
          owner || oldAsset.owner,
          remarks !== undefined ? remarks : oldAsset.remarks,
          attributes || oldAsset.additional_attributes,
          id
        ];
      } else {
        updateStr = `
          UPDATE telecom_assets
          SET name = $1, asset_type = $2, status = $3, owner = $4, remarks = $5, 
              additional_attributes = $6, updated_at = CURRENT_TIMESTAMP
          WHERE id = $7
          RETURNING id, name, asset_type, status, owner, installation_date, remarks,
                    additional_attributes, is_deleted, created_at, updated_at,
                    ST_AsGeoJSON(geom)::json AS geom_json
        `;
        params = [
          name || oldAsset.name,
          asset_type || oldAsset.asset_type,
          status || oldAsset.status,
          owner || oldAsset.owner,
          remarks !== undefined ? remarks : oldAsset.remarks,
          attributes || oldAsset.additional_attributes,
          id
        ];
      }

      const updateRes = await client.query(updateStr, params);
      const newAsset = updateRes.rows[0];

      // 3. Log history
      const insertHistoryStr = `
        INSERT INTO edit_history (table_name, record_id, action, old_data, new_data, changed_by)
        VALUES ('telecom_assets', $1, 'UPDATE', $2, $3, $4)
      `;
      await client.query(insertHistoryStr, [
        id,
        JSON.stringify(oldAsset),
        JSON.stringify(newAsset),
        userId
      ]);

      return newAsset;
    });

    res.json(assetToGeoJSON(updatedAsset));
  } catch (err) {
    console.error('updateAsset error:', err.message);
    if (err.message === 'Asset not found') {
      return res.status(404).json({ message: err.message });
    }
    res.status(500).json({ message: 'Server error updating asset' });
  }
};

// Soft delete Asset
exports.deleteAsset = async (req, res) => {
  const { id } = req.params;
  const userId = req.user ? req.user.id : null;

  try {
    await db.transaction(async (client) => {
      // 1. Get current asset data
      const getAssetStr = `
        SELECT id, name, asset_type, status, owner, installation_date, remarks, 
               additional_attributes, is_deleted, created_at, updated_at,
               ST_AsGeoJSON(geom)::json AS geom_json
        FROM telecom_assets WHERE id = $1 AND is_deleted = false
      `;
      const currentRes = await client.query(getAssetStr, [id]);
      if (currentRes.rows.length === 0) {
        throw new Error('Asset not found or already deleted');
      }
      const oldAsset = currentRes.rows[0];

      // 2. Soft-delete asset
      const softDeleteStr = `
        UPDATE telecom_assets
        SET is_deleted = true, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, name, asset_type, status, owner, installation_date, remarks,
                  additional_attributes, is_deleted, created_at, updated_at,
                  ST_AsGeoJSON(geom)::json AS geom_json
      `;
      const deleteRes = await client.query(softDeleteStr, [id]);
      const deletedAsset = deleteRes.rows[0];

      // Also remove associated connectivity links
      const removeLinksStr = `DELETE FROM connectivity_links WHERE from_asset_id = $1 OR to_asset_id = $1`;
      await client.query(removeLinksStr, [id]);

      // 3. Log history
      const insertHistoryStr = `
        INSERT INTO edit_history (table_name, record_id, action, old_data, new_data, changed_by)
        VALUES ('telecom_assets', $1, 'DELETE', $2, $3, $4)
      `;
      await client.query(insertHistoryStr, [
        id,
        JSON.stringify(oldAsset),
        JSON.stringify(deletedAsset),
        userId
      ]);
    });

    res.json({ message: 'Asset deleted successfully (soft-delete)', id: parseInt(id) });
  } catch (err) {
    console.error('deleteAsset error:', err.message);
    if (err.message === 'Asset not found or already deleted') {
      return res.status(404).json({ message: err.message });
    }
    res.status(500).json({ message: 'Server error deleting asset' });
  }
};

// Recover soft-deleted Asset
exports.recoverAsset = async (req, res) => {
  const { id } = req.params;
  const userId = req.user ? req.user.id : null;

  try {
    const recovered = await db.transaction(async (client) => {
      const getAssetStr = `
        SELECT id, name, asset_type, status, owner, installation_date, remarks, 
               additional_attributes, is_deleted, created_at, updated_at,
               ST_AsGeoJSON(geom)::json AS geom_json
        FROM telecom_assets WHERE id = $1 AND is_deleted = true
      `;
      const currentRes = await client.query(getAssetStr, [id]);
      if (currentRes.rows.length === 0) {
        throw new Error('Asset not found or is not deleted');
      }
      const oldAsset = currentRes.rows[0];

      const recoverStr = `
        UPDATE telecom_assets
        SET is_deleted = false, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, name, asset_type, status, owner, installation_date, remarks,
                  additional_attributes, is_deleted, created_at, updated_at,
                  ST_AsGeoJSON(geom)::json AS geom_json
      `;
      const recoverRes = await client.query(recoverStr, [id]);
      const newAsset = recoverRes.rows[0];

      const insertHistoryStr = `
        INSERT INTO edit_history (table_name, record_id, action, old_data, new_data, changed_by)
        VALUES ('telecom_assets', $1, 'RESTORE', $2, $3, $4)
      `;
      await client.query(insertHistoryStr, [
        id,
        JSON.stringify(oldAsset),
        JSON.stringify(newAsset),
        userId
      ]);

      return newAsset;
    });

    res.json(assetToGeoJSON(recovered));
  } catch (err) {
    console.error('recoverAsset error:', err.message);
    if (err.message === 'Asset not found or is not deleted') {
      return res.status(404).json({ message: err.message });
    }
    res.status(500).json({ message: 'Server error recovering asset' });
  }
};

// ==========================================
// ROUTE CONTROLLERS (LINES: CABLES, DUCTS)
// ==========================================

// Get all non-deleted Routes
exports.getRoutes = async (req, res) => {
  try {
    const queryStr = `
      SELECT id, name, route_type, status, owner, installation_date, length_meters, remarks, 
             additional_attributes, is_deleted, created_at, updated_at,
             ST_AsGeoJSON(geom)::json AS geom_json 
      FROM telecom_routes 
      WHERE is_deleted = false
    `;
    const result = await db.query(queryStr);
    const features = result.rows.map(routeToGeoJSON);
    res.json({
      type: 'FeatureCollection',
      features
    });
  } catch (err) {
    console.error('getRoutes error:', err.message);
    res.status(500).json({ message: 'Server error retrieving routes' });
  }
};

// Create a new Route
exports.createRoute = async (req, res) => {
  const { name, route_type, geometry, status, owner, remarks, ...attributes } = req.body;
  const userId = req.user ? req.user.id : null;

  if (!name || !route_type || !geometry || !geometry.coordinates) {
    return res.status(400).json({ message: 'Missing required fields (name, route_type, geometry)' });
  }

  try {
    const newRoute = await db.transaction(async (client) => {
      const geomGeoJSON = JSON.stringify(geometry);
      const insertRouteStr = `
        INSERT INTO telecom_routes 
          (name, route_type, geom, status, owner, remarks, additional_attributes, created_by)
        VALUES 
          ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4, $5, $6, $7, $8)
        RETURNING id, name, route_type, status, owner, installation_date, length_meters, remarks,
                  additional_attributes, is_deleted, created_at, updated_at,
                  ST_AsGeoJSON(geom)::json AS geom_json
      `;
      const routeResult = await client.query(insertRouteStr, [
        name,
        route_type,
        geomGeoJSON,
        status || 'Planned',
        owner || 'Company',
        remarks || '',
        attributes || {},
        userId
      ]);

      const route = routeResult.rows[0];

      const insertHistoryStr = `
        INSERT INTO edit_history (table_name, record_id, action, new_data, changed_by)
        VALUES ('telecom_routes', $1, 'INSERT', $2, $3)
      `;
      await client.query(insertHistoryStr, [route.id, JSON.stringify(route), userId]);

      return route;
    });

    res.status(201).json(routeToGeoJSON(newRoute));
  } catch (err) {
    console.error('createRoute error:', err.message);
    res.status(500).json({ message: 'Server error creating route: ' + err.message });
  }
};

// Update a Route
exports.updateRoute = async (req, res) => {
  const { id } = req.params;
  const { name, route_type, geometry, status, owner, remarks, ...attributes } = req.body;
  const userId = req.user ? req.user.id : null;

  try {
    const updatedRoute = await db.transaction(async (client) => {
      const getRouteStr = `
        SELECT id, name, route_type, status, owner, installation_date, length_meters, remarks, 
               additional_attributes, is_deleted, created_at, updated_at,
               ST_AsGeoJSON(geom)::json AS geom_json
        FROM telecom_routes WHERE id = $1
      `;
      const currentRes = await client.query(getRouteStr, [id]);
      if (currentRes.rows.length === 0) {
        throw new Error('Route not found');
      }
      const oldRoute = currentRes.rows[0];

      let updateStr = '';
      let params = [];

      if (geometry) {
        updateStr = `
          UPDATE telecom_routes
          SET name = $1, route_type = $2, geom = ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), 
              status = $4, owner = $5, remarks = $6, additional_attributes = $7, updated_at = CURRENT_TIMESTAMP
          WHERE id = $8
          RETURNING id, name, route_type, status, owner, installation_date, length_meters, remarks,
                    additional_attributes, is_deleted, created_at, updated_at,
                    ST_AsGeoJSON(geom)::json AS geom_json
        `;
        params = [
          name || oldRoute.name,
          route_type || oldRoute.route_type,
          JSON.stringify(geometry),
          status || oldRoute.status,
          owner || oldRoute.owner,
          remarks !== undefined ? remarks : oldRoute.remarks,
          attributes || oldRoute.additional_attributes,
          id
        ];
      } else {
        updateStr = `
          UPDATE telecom_routes
          SET name = $1, route_type = $2, status = $3, owner = $4, remarks = $5, 
              additional_attributes = $6, updated_at = CURRENT_TIMESTAMP
          WHERE id = $7
          RETURNING id, name, route_type, status, owner, installation_date, length_meters, remarks,
                    additional_attributes, is_deleted, created_at, updated_at,
                    ST_AsGeoJSON(geom)::json AS geom_json
        `;
        params = [
          name || oldRoute.name,
          route_type || oldRoute.route_type,
          status || oldRoute.status,
          owner || oldRoute.owner,
          remarks !== undefined ? remarks : oldRoute.remarks,
          attributes || oldRoute.additional_attributes,
          id
        ];
      }

      const updateRes = await client.query(updateStr, params);
      const newRoute = updateRes.rows[0];

      const insertHistoryStr = `
        INSERT INTO edit_history (table_name, record_id, action, old_data, new_data, changed_by)
        VALUES ('telecom_routes', $1, 'UPDATE', $2, $3, $4)
      `;
      await client.query(insertHistoryStr, [
        id,
        JSON.stringify(oldRoute),
        JSON.stringify(newRoute),
        userId
      ]);

      return newRoute;
    });

    res.json(routeToGeoJSON(updatedRoute));
  } catch (err) {
    console.error('updateRoute error:', err.message);
    if (err.message === 'Route not found') {
      return res.status(404).json({ message: err.message });
    }
    res.status(500).json({ message: 'Server error updating route' });
  }
};

// Soft delete Route
exports.deleteRoute = async (req, res) => {
  const { id } = req.params;
  const userId = req.user ? req.user.id : null;

  try {
    await db.transaction(async (client) => {
      const getRouteStr = `
        SELECT id, name, route_type, status, owner, installation_date, length_meters, remarks, 
               additional_attributes, is_deleted, created_at, updated_at,
               ST_AsGeoJSON(geom)::json AS geom_json
        FROM telecom_routes WHERE id = $1 AND is_deleted = false
      `;
      const currentRes = await client.query(getRouteStr, [id]);
      if (currentRes.rows.length === 0) {
        throw new Error('Route not found or already deleted');
      }
      const oldRoute = currentRes.rows[0];

      const softDeleteStr = `
        UPDATE telecom_routes
        SET is_deleted = true, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, name, route_type, status, owner, installation_date, length_meters, remarks,
                  additional_attributes, is_deleted, created_at, updated_at,
                  ST_AsGeoJSON(geom)::json AS geom_json
      `;
      const deleteRes = await client.query(softDeleteStr, [id]);
      const deletedRoute = deleteRes.rows[0];

      // Remove from active links
      const removeLinksStr = `DELETE FROM connectivity_links WHERE route_id = $1`;
      await client.query(removeLinksStr, [id]);

      const insertHistoryStr = `
        INSERT INTO edit_history (table_name, record_id, action, old_data, new_data, changed_by)
        VALUES ('telecom_routes', $1, 'DELETE', $2, $3, $4)
      `;
      await client.query(insertHistoryStr, [
        id,
        JSON.stringify(oldRoute),
        JSON.stringify(deletedRoute),
        userId
      ]);
    });

    res.json({ message: 'Route deleted successfully (soft-delete)', id: parseInt(id) });
  } catch (err) {
    console.error('deleteRoute error:', err.message);
    if (err.message === 'Route not found or already deleted') {
      return res.status(404).json({ message: err.message });
    }
    res.status(500).json({ message: 'Server error deleting route' });
  }
};

// Recover soft-deleted Route
exports.recoverRoute = async (req, res) => {
  const { id } = req.params;
  const userId = req.user ? req.user.id : null;

  try {
    const recovered = await db.transaction(async (client) => {
      const getRouteStr = `
        SELECT id, name, route_type, status, owner, installation_date, length_meters, remarks, 
               additional_attributes, is_deleted, created_at, updated_at,
               ST_AsGeoJSON(geom)::json AS geom_json
        FROM telecom_routes WHERE id = $1 AND is_deleted = true
      `;
      const currentRes = await client.query(getRouteStr, [id]);
      if (currentRes.rows.length === 0) {
        throw new Error('Route not found or is not deleted');
      }
      const oldRoute = currentRes.rows[0];

      const recoverStr = `
        UPDATE telecom_routes
        SET is_deleted = false, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, name, route_type, status, owner, installation_date, length_meters, remarks,
                  additional_attributes, is_deleted, created_at, updated_at,
                  ST_AsGeoJSON(geom)::json AS geom_json
      `;
      const recoverRes = await client.query(recoverStr, [id]);
      const newRoute = recoverRes.rows[0];

      const insertHistoryStr = `
        INSERT INTO edit_history (table_name, record_id, action, old_data, new_data, changed_by)
        VALUES ('telecom_routes', $1, 'RESTORE', $2, $3, $4)
      `;
      await client.query(insertHistoryStr, [
        id,
        JSON.stringify(oldAsset),
        JSON.stringify(newRoute),
        userId
      ]);

      return newRoute;
    });

    res.json(routeToGeoJSON(recovered));
  } catch (err) {
    console.error('recoverRoute error:', err.message);
    if (err.message === 'Route not found or is not deleted') {
      return res.status(404).json({ message: err.message });
    }
    res.status(500).json({ message: 'Server error recovering route' });
  }
};

// ==========================================
// ADVANCED EDITING ROUTE TOOLS (SPLIT & MERGE)
// ==========================================

// Split Route (Line) into 2 parts
exports.splitRoute = async (req, res) => {
  const { routeId, splitPoint } = req.body; // splitPoint is GeoJSON Point { coordinates: [lng, lat] }
  const userId = req.user ? req.user.id : null;

  if (!routeId || !splitPoint || !splitPoint.coordinates) {
    return res.status(400).json({ message: 'routeId and splitPoint are required' });
  }

  try {
    const resultParts = await db.transaction(async (client) => {
      // 1. Get the route to be split
      const getRouteStr = `SELECT * FROM telecom_routes WHERE id = $1 AND is_deleted = false`;
      const routeRes = await client.query(getRouteStr, [routeId]);
      if (routeRes.rows.length === 0) {
        throw new Error('Route not found or already deleted');
      }
      const route = routeRes.rows[0];

      // 2. Perform splitting using PostGIS spatial functions
      // We project the splitPoint onto the LineString, get the fractional location along the line, 
      // and split the line using ST_LineSubstring.
      const splitGeoJSON = JSON.stringify(splitPoint);

      const splitQuery = `
        WITH line_proj AS (
          SELECT ST_LineLocatePoint(geom, ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS loc, geom
          FROM telecom_routes WHERE id = $2
        )
        SELECT 
          ST_AsGeoJSON(ST_LineSubstring(geom, 0, CASE WHEN loc = 0 THEN 0.01 WHEN loc = 1 THEN 0.99 ELSE loc END))::json AS part1,
          ST_AsGeoJSON(ST_LineSubstring(geom, CASE WHEN loc = 0 THEN 0.01 WHEN loc = 1 THEN 0.99 ELSE loc END, 1))::json AS part2
        FROM line_proj
      `;
      const splitRes = await client.query(splitQuery, [splitGeoJSON, routeId]);
      if (splitRes.rows.length === 0 || !splitRes.rows[0].part1 || !splitRes.rows[0].part2) {
        throw new Error('Failed to split line at specified point');
      }

      const { part1, part2 } = splitRes.rows[0];

      // 3. Soft-delete the original route
      await client.query(`UPDATE telecom_routes SET is_deleted = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [routeId]);
      
      // Remove connection references pointing to original route
      await client.query(`UPDATE connectivity_links SET route_id = NULL WHERE route_id = $1`, [routeId]);

      // 4. Create the two split routes
      const insertStr = `
        INSERT INTO telecom_routes (name, route_type, geom, status, owner, remarks, additional_attributes, created_by)
        VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4, $5, $6, $7, $8)
        RETURNING id, name, route_type, status, owner, installation_date, length_meters, remarks,
                  additional_attributes, is_deleted, created_at, updated_at, ST_AsGeoJSON(geom)::json AS geom_json
      `;

      const part1Res = await client.query(insertStr, [
        `${route.name} (Part A)`,
        route.route_type,
        JSON.stringify(part1),
        route.status,
        route.owner,
        route.remarks || 'Created via line split',
        route.additional_attributes,
        userId
      ]);

      const part2Res = await client.query(insertStr, [
        `${route.name} (Part B)`,
        route.route_type,
        JSON.stringify(part2),
        route.status,
        route.owner,
        route.remarks || 'Created via line split',
        route.additional_attributes,
        userId
      ]);

      const res1 = part1Res.rows[0];
      const res2 = part2Res.rows[0];

      // 5. Log in history
      const historyLog = {
        originalRouteId: routeId,
        splitParts: [res1.id, res2.id]
      };
      await client.query(
        `INSERT INTO edit_history (table_name, record_id, action, old_data, new_data, changed_by)
         VALUES ('telecom_routes', $1, 'UPDATE', $2, $3, $4)`,
        [routeId, JSON.stringify(route), JSON.stringify(historyLog), userId]
      );

      return [res1, res2];
    });

    res.json({
      message: 'Route split successfully',
      features: resultParts.map(routeToGeoJSON)
    });
  } catch (err) {
    console.error('splitRoute error:', err.message);
    res.status(500).json({ message: 'Server error splitting route: ' + err.message });
  }
};

// Merge 2 Routes (Lines) into 1
exports.mergeRoutes = async (req, res) => {
  const { routeId1, routeId2 } = req.body;
  const userId = req.user ? req.user.id : null;

  if (!routeId1 || !routeId2) {
    return res.status(400).json({ message: 'routeId1 and routeId2 are required' });
  }

  try {
    const mergedRoute = await db.transaction(async (client) => {
      // 1. Fetch details of both lines
      const route1Res = await client.query(`SELECT * FROM telecom_routes WHERE id = $1 AND is_deleted = false`, [routeId1]);
      const route2Res = await client.query(`SELECT * FROM telecom_routes WHERE id = $1 AND is_deleted = false`, [routeId2]);
      if (route1Res.rows.length === 0 || route2Res.rows.length === 0) {
        throw new Error('One or both routes not found or deleted');
      }

      const r1 = route1Res.rows[0];
      const r2 = route2Res.rows[0];

      if (r1.route_type !== r2.route_type) {
        throw new Error('Cannot merge routes of different types');
      }

      // 2. Perform merge using PostGIS ST_LineMerge(ST_Union(geom1, geom2))
      const mergeQuery = `
        SELECT ST_AsGeoJSON(ST_LineMerge(ST_Union(r1.geom, r2.geom)))::json AS merged_geom
        FROM telecom_routes r1, telecom_routes r2
        WHERE r1.id = $1 AND r2.id = $2
      `;
      const mergeRes = await client.query(mergeQuery, [routeId1, routeId2]);
      if (mergeRes.rows.length === 0 || !mergeRes.rows[0].merged_geom) {
        throw new Error('Routes do not touch or cannot be merged into a single linestring');
      }

      const mergedGeom = mergeRes.rows[0].merged_geom;

      // 3. Soft-delete the original routes
      await client.query(`UPDATE telecom_routes SET is_deleted = true, updated_at = CURRENT_TIMESTAMP WHERE id IN ($1, $2)`, [routeId1, routeId2]);

      // Remove connections reference to these routes
      await client.query(`UPDATE connectivity_links SET route_id = NULL WHERE route_id IN ($1, $2)`, [routeId1, routeId2]);

      // 4. Create new merged route
      const insertStr = `
        INSERT INTO telecom_routes (name, route_type, geom, status, owner, remarks, additional_attributes, created_by)
        VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4, $5, $6, $7, $8)
        RETURNING id, name, route_type, status, owner, installation_date, length_meters, remarks,
                  additional_attributes, is_deleted, created_at, updated_at, ST_AsGeoJSON(geom)::json AS geom_json
      `;

      const insertRes = await client.query(insertStr, [
        `${r1.name} + ${r2.name} (Merged)`,
        r1.route_type,
        JSON.stringify(mergedGeom),
        r1.status,
        r1.owner,
        `Merged from ID ${routeId1} and ID ${routeId2}`,
        { ...r1.additional_attributes, ...r2.additional_attributes },
        userId
      ]);

      const newRoute = insertRes.rows[0];

      // 5. Log in history
      const historyLog = {
        mergedRouteId: newRoute.id,
        sources: [r1, r2]
      };
      await client.query(
        `INSERT INTO edit_history (table_name, record_id, action, old_data, new_data, changed_by)
         VALUES ('telecom_routes', $1, 'UPDATE', $2, $3, $4)`,
        [newRoute.id, JSON.stringify(historyLog), JSON.stringify(newRoute), userId]
      );

      return newRoute;
    });

    res.json(routeToGeoJSON(mergedRoute));
  } catch (err) {
    console.error('mergeRoutes error:', err.message);
    res.status(500).json({ message: 'Server error merging routes: ' + err.message });
  }
};

// ==========================================
// AUDIT LOG & UNDO SYSTEM
// ==========================================

// Get recent operations history
exports.getHistory = async (req, res) => {
  try {
    const historyQuery = `
      SELECT h.id, h.table_name, h.record_id, h.action, h.old_data, h.new_data, h.changed_at, u.username
      FROM edit_history h
      LEFT JOIN users u ON h.changed_by = u.id
      ORDER BY h.changed_at DESC
      LIMIT 100
    `;
    const result = await db.query(historyQuery);
    res.json(result.rows);
  } catch (err) {
    console.error('getHistory error:', err.message);
    res.status(500).json({ message: 'Server error fetching history log' });
  }
};

// Undo the latest action
exports.undoAction = async (req, res) => {
  const userId = req.user ? req.user.id : null;

  try {
    const message = await db.transaction(async (client) => {
      // 1. Fetch latest history record
      const latestRes = await client.query(`
        SELECT * FROM edit_history 
        ORDER BY changed_at DESC 
        LIMIT 1
      `);
      if (latestRes.rows.length === 0) {
        throw new Error('No actions in history to undo');
      }

      const log = latestRes.rows[0];

      // 2. Perform inverse action based on log type
      if (log.action === 'INSERT') {
        // Reverse INSERT by deleting the record (soft delete)
        const queryStr = `UPDATE ${log.table_name} SET is_deleted = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`;
        await client.query(queryStr, [log.record_id]);
      } 
      else if (log.action === 'DELETE') {
        // Reverse DELETE by restoring (setting is_deleted to false)
        const queryStr = `UPDATE ${log.table_name} SET is_deleted = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1`;
        await client.query(queryStr, [log.record_id]);
      } 
      else if (log.action === 'RESTORE') {
        // Reverse RESTORE by soft-deleting again
        const queryStr = `UPDATE ${log.table_name} SET is_deleted = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`;
        await client.query(queryStr, [log.record_id]);
      } 
      else if (log.action === 'UPDATE') {
        // Reverse UPDATE by writing back old data
        const oldData = log.old_data;
        if (!oldData) {
          throw new Error('Cannot undo update; original data missing');
        }

        if (log.table_name === 'telecom_assets') {
          const updateStr = `
            UPDATE telecom_assets
            SET name = $1, asset_type = $2, geom = ST_SetSRID(ST_GeomFromGeoJSON($3), 4326),
                status = $4, owner = $5, remarks = $6, additional_attributes = $7, is_deleted = $8, updated_at = CURRENT_TIMESTAMP
            WHERE id = $9
          `;
          await client.query(updateStr, [
            oldData.name,
            oldData.asset_type,
            JSON.stringify(oldData.geom_json),
            oldData.status,
            oldData.owner,
            oldData.remarks,
            oldData.additional_attributes,
            oldData.is_deleted,
            log.record_id
          ]);
        } else if (log.table_name === 'telecom_routes') {
          // If update was a split/merge, oldData has details of previous structure.
          // Let's restore the original line
          const updateStr = `
            UPDATE telecom_routes
            SET name = $1, route_type = $2, geom = ST_SetSRID(ST_GeomFromGeoJSON($3), 4326),
                status = $4, owner = $5, remarks = $6, additional_attributes = $7, is_deleted = $8, updated_at = CURRENT_TIMESTAMP
            WHERE id = $9
          `;
          await client.query(updateStr, [
            oldData.name,
            oldData.route_type,
            JSON.stringify(oldData.geom_json),
            oldData.status,
            oldData.owner,
            oldData.remarks,
            oldData.additional_attributes,
            oldData.is_deleted,
            log.record_id
          ]);

          // If oldData is log of a split, we delete the created segments
          if (log.new_data && log.new_data.splitParts) {
            const deletePartsStr = `UPDATE telecom_routes SET is_deleted = true WHERE id IN (${log.new_data.splitParts.join(',')})`;
            await client.query(deletePartsStr);
          }
          // If oldData is log of a merge, we restore the original segments
          if (log.old_data && log.old_data.sources) {
            const sourceIds = log.old_data.sources.map(s => s.id);
            const restoreSourcesStr = `UPDATE telecom_routes SET is_deleted = false WHERE id IN (${sourceIds.join(',')})`;
            await client.query(restoreSourcesStr);
            // Delete merged result line
            await client.query(`UPDATE telecom_routes SET is_deleted = true WHERE id = $1`, [log.record_id]);
          }
        }
      }

      // 3. Remove this record from history so next Undo can process the previous action
      await client.query('DELETE FROM edit_history WHERE id = $1', [log.id]);

      return `Successfully undid action [${log.action}] on [${log.table_name}] ID ${log.record_id}`;
    });

    res.json({ message });
  } catch (err) {
    console.error('undoAction error:', err.message);
    res.status(500).json({ message: 'Server error running undo: ' + err.message });
  }
};
