const db = require('../config/db');

// Helper to convert DB rows to a complete network trace payload
const formatTraceResult = async (client, nodeIds, routeIds) => {
  // If arrays are empty, return empty feature collections
  if (nodeIds.length === 0) {
    return {
      assets: { type: 'FeatureCollection', features: [] },
      routes: { type: 'FeatureCollection', features: [] }
    };
  }

  // Query assets
  const assetsQuery = `
    SELECT id, name, asset_type, status, owner, installation_date, remarks, 
           additional_attributes, is_deleted, created_at, updated_at,
           ST_AsGeoJSON(geom)::json AS geom_json 
    FROM telecom_assets 
    WHERE id = ANY($1) AND is_deleted = false
  `;
  const assetsRes = await client.query(assetsQuery, [nodeIds]);
  const assetFeatures = assetsRes.rows.map(row => ({
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
      ...row.additional_attributes
    }
  }));

  // Query routes
  let routeFeatures = [];
  const validRouteIds = routeIds.filter(id => id !== null && id !== undefined);
  if (validRouteIds.length > 0) {
    const routesQuery = `
      SELECT id, name, route_type, status, owner, installation_date, length_meters, remarks, 
             additional_attributes, is_deleted, created_at, updated_at,
             ST_AsGeoJSON(geom)::json AS geom_json 
      FROM telecom_routes 
      WHERE id = ANY($1) AND is_deleted = false
    `;
    const routesRes = await client.query(routesQuery, [validRouteIds]);
    routeFeatures = routesRes.rows.map(row => ({
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
        ...row.additional_attributes
      }
    }));
  }

  return {
    assets: { type: 'FeatureCollection', features: assetFeatures },
    routes: { type: 'FeatureCollection', features: routeFeatures }
  };
};

// ==========================================
// TOPOLOGY MANAGEMENT
// ==========================================

// Get all connectivity links
exports.getLinks = async (req, res) => {
  try {
    const queryStr = `
      SELECT l.id, l.from_asset_id, l.to_asset_id, l.route_id, l.link_type, l.details, l.created_at,
             a1.name AS from_asset_name, a2.name AS to_asset_name, r.name AS route_name
      FROM connectivity_links l
      JOIN telecom_assets a1 ON l.from_asset_id = a1.id
      JOIN telecom_assets a2 ON l.to_asset_id = a2.id
      LEFT JOIN telecom_routes r ON l.route_id = r.id
      ORDER BY l.created_at DESC
    `;
    const result = await db.query(queryStr);
    res.json(result.rows);
  } catch (err) {
    console.error('getLinks error:', err.message);
    res.status(500).json({ message: 'Server error retrieving links' });
  }
};

// Create a new connectivity link (ACID transaction)
exports.createLink = async (req, res) => {
  const { from_asset_id, to_asset_id, route_id, link_type, details } = req.body;
  const userId = req.user ? req.user.id : null;

  if (!from_asset_id || !to_asset_id || !link_type) {
    return res.status(400).json({ message: 'Missing required link fields' });
  }

  try {
    const newLink = await db.transaction(async (client) => {
      // 1. Verify assets exist and are not deleted
      const checkAsset = await client.query('SELECT id FROM telecom_assets WHERE id IN ($1, $2) AND is_deleted = false', [from_asset_id, to_asset_id]);
      if (checkAsset.rows.length < 2 && from_asset_id !== to_asset_id) {
        throw new Error('One or both assets are invalid or deleted');
      }

      // 2. Prevent duplicate links
      const checkDup = await client.query(
        `SELECT id FROM connectivity_links 
         WHERE (from_asset_id = $1 AND to_asset_id = $2) OR (from_asset_id = $2 AND to_asset_id = $1)`,
        [from_asset_id, to_asset_id]
      );
      if (checkDup.rows.length > 0) {
        throw new Error('Connectivity link already exists between these assets');
      }

      // 3. Insert link
      const insertLinkStr = `
        INSERT INTO connectivity_links (from_asset_id, to_asset_id, route_id, link_type, details)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;
      const result = await client.query(insertLinkStr, [
        from_asset_id,
        to_asset_id,
        route_id || null,
        link_type,
        details || {}
      ]);

      const link = result.rows[0];

      // 4. Log in edit history
      await client.query(
        `INSERT INTO edit_history (table_name, record_id, action, new_data, changed_by)
         VALUES ('connectivity_links', $1, 'INSERT', $2, $3)`,
        [link.id, JSON.stringify(link), userId]
      );

      return link;
    });

    res.status(201).json(newLink);
  } catch (err) {
    console.error('createLink error:', err.message);
    res.status(400).json({ message: err.message });
  }
};

// Delete a link (ACID transaction)
exports.deleteLink = async (req, res) => {
  const { id } = req.params;
  const userId = req.user ? req.user.id : null;

  try {
    await db.transaction(async (client) => {
      // 1. Get old link details
      const checkLink = await client.query('SELECT * FROM connectivity_links WHERE id = $1', [id]);
      if (checkLink.rows.length === 0) {
        throw new Error('Connectivity link not found');
      }
      const oldLink = checkLink.rows[0];

      // 2. Delete link
      await client.query('DELETE FROM connectivity_links WHERE id = $1', [id]);

      // 3. Log history
      await client.query(
        `INSERT INTO edit_history (table_name, record_id, action, old_data, changed_by)
         VALUES ('connectivity_links', $1, 'DELETE', $2, $3)`,
        [id, JSON.stringify(oldLink), userId]
      );
    });

    res.json({ message: 'Connectivity link removed successfully', id: parseInt(id) });
  } catch (err) {
    console.error('deleteLink error:', err.message);
    res.status(404).json({ message: err.message });
  }
};

// ==========================================
// TELECOM TRACING ALGORITHMS
// ==========================================

// UPSTREAM TRACE: BFS path up to OLT
exports.upstreamTrace = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.transaction(async (client) => {
      // Trace graph recursively using CTE
      const traceQuery = `
        WITH RECURSIVE upstream_bfs AS (
          -- Anchor: start from the selected asset
          SELECT 
            id AS node_id,
            asset_type,
            ARRAY[id] AS visited_nodes,
            ARRAY[]::integer[] AS visited_routes
          FROM telecom_assets
          WHERE id = $1 AND is_deleted = false

          UNION ALL

          -- Recursive: join on connectivity links
          SELECT 
            next_asset.id AS node_id,
            next_asset.asset_type,
            b.visited_nodes || next_asset.id,
            b.visited_routes || COALESCE(l.route_id, 0)
          FROM upstream_bfs b
          JOIN connectivity_links l ON (l.from_asset_id = b.node_id OR l.to_asset_id = b.node_id)
          JOIN telecom_assets next_asset ON (
            next_asset.id = CASE WHEN l.from_asset_id = b.node_id THEN l.to_asset_id ELSE l.from_asset_id END
          )
          WHERE next_asset.is_deleted = false 
            AND NOT (next_asset.id = ANY(b.visited_nodes))
            -- To isolate upstream, once we reach an OLT, we stop traversing further from it
            AND b.asset_type <> 'olt'
        )
        SELECT visited_nodes, visited_routes, asset_type, node_id FROM upstream_bfs;
      `;
      const traceRes = await client.query(traceQuery, [id]);
      
      // We gather all visited assets and routes on any path that successfully terminates at or includes an OLT
      let OLTPaths = traceRes.rows.filter(row => row.asset_type === 'olt');
      
      // If no path reaches OLT, return the full connected path up as the next best thing
      if (OLTPaths.length === 0) {
        OLTPaths = traceRes.rows;
      }

      const nodeSet = new Set();
      const routeSet = new Set();

      OLTPaths.forEach(path => {
        path.visited_nodes.forEach(n => nodeSet.add(n));
        path.visited_routes.forEach(r => {
          if (r > 0) routeSet.add(r);
        });
      });

      // Format outputs as full GeoJSON collections
      return await formatTraceResult(client, Array.from(nodeSet), Array.from(routeSet));
    });

    res.json(result);
  } catch (err) {
    console.error('upstreamTrace error:', err.message);
    res.status(500).json({ message: 'Server error running upstream trace' });
  }
};

// DOWNSTREAM TRACE: BFS downwards from source towards ONT/Customers
exports.downstreamTrace = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.transaction(async (client) => {
      const traceQuery = `
        WITH RECURSIVE downstream_bfs AS (
          -- Anchor: start from selected asset (e.g. OLT)
          SELECT 
            id AS node_id,
            asset_type,
            ARRAY[id] AS visited_nodes,
            ARRAY[]::integer[] AS visited_routes
          FROM telecom_assets
          WHERE id = $1 AND is_deleted = false

          UNION ALL

          -- Recursive: join on links
          SELECT 
            next_asset.id AS node_id,
            next_asset.asset_type,
            b.visited_nodes || next_asset.id,
            b.visited_routes || COALESCE(l.route_id, 0)
          FROM downstream_bfs b
          JOIN connectivity_links l ON (l.from_asset_id = b.node_id OR l.to_asset_id = b.node_id)
          JOIN telecom_assets next_asset ON (
            next_asset.id = CASE WHEN l.from_asset_id = b.node_id THEN l.to_asset_id ELSE l.from_asset_id END
          )
          WHERE next_asset.is_deleted = false 
            AND NOT (next_asset.id = ANY(b.visited_nodes))
            -- To isolate downstream, we do not trace backwards towards the OLT if we started downstream
            AND next_asset.asset_type <> 'olt'
        )
        SELECT visited_nodes, visited_routes FROM downstream_bfs;
      `;
      const traceRes = await client.query(traceQuery, [id]);

      const nodeSet = new Set();
      const routeSet = new Set();

      traceRes.rows.forEach(path => {
        path.visited_nodes.forEach(n => nodeSet.add(n));
        path.visited_routes.forEach(r => {
          if (r > 0) routeSet.add(r);
        });
      });

      return await formatTraceResult(client, Array.from(nodeSet), Array.from(routeSet));
    });

    res.json(result);
  } catch (err) {
    console.error('downstreamTrace error:', err.message);
    res.status(500).json({ message: 'Server error running downstream trace' });
  }
};

// FULL NETWORK TRACE: Returns everything recursively connected to the asset
exports.fullTrace = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.transaction(async (client) => {
      const traceQuery = `
        WITH RECURSIVE full_bfs AS (
          SELECT 
            id AS node_id,
            ARRAY[id] AS visited_nodes,
            ARRAY[]::integer[] AS visited_routes
          FROM telecom_assets
          WHERE id = $1 AND is_deleted = false

          UNION ALL

          SELECT 
            next_asset.id AS node_id,
            b.visited_nodes || next_asset.id,
            b.visited_routes || COALESCE(l.route_id, 0)
          FROM full_bfs b
          JOIN connectivity_links l ON (l.from_asset_id = b.node_id OR l.to_asset_id = b.node_id)
          JOIN telecom_assets next_asset ON (
            next_asset.id = CASE WHEN l.from_asset_id = b.node_id THEN l.to_asset_id ELSE l.from_asset_id END
          )
          WHERE next_asset.is_deleted = false AND NOT (next_asset.id = ANY(b.visited_nodes))
        )
        SELECT visited_nodes, visited_routes FROM full_bfs;
      `;
      const traceRes = await client.query(traceQuery, [id]);

      const nodeSet = new Set();
      const routeSet = new Set();

      traceRes.rows.forEach(path => {
        path.visited_nodes.forEach(n => nodeSet.add(n));
        path.visited_routes.forEach(r => {
          if (r > 0) routeSet.add(r);
        });
      });

      return await formatTraceResult(client, Array.from(nodeSet), Array.from(routeSet));
    });

    res.json(result);
  } catch (err) {
    console.error('fullTrace error:', err.message);
    res.status(500).json({ message: 'Server error running full trace' });
  }
};

// SHORTEST PATH ANALYSIS between startAssetId and endAssetId
exports.shortestPath = async (req, res) => {
  const { startAssetId, endAssetId } = req.body;

  if (!startAssetId || !endAssetId) {
    return res.status(400).json({ message: 'startAssetId and endAssetId are required' });
  }

  try {
    const result = await db.transaction(async (client) => {
      // Find paths using recursive CTE
      const pathQuery = `
        WITH RECURSIVE path_finder AS (
          SELECT 
            id AS node_id,
            ARRAY[id] AS visited_nodes,
            ARRAY[]::integer[] AS visited_routes,
            0 AS path_length_m
          FROM telecom_assets
          WHERE id = $1 AND is_deleted = false

          UNION ALL

          SELECT 
            next_asset.id AS node_id,
            b.visited_nodes || next_asset.id,
            b.visited_routes || COALESCE(l.route_id, 0),
            b.path_length_m + COALESCE((SELECT length_meters FROM telecom_routes WHERE id = l.route_id), 0) AS path_length_m
          FROM path_finder b
          JOIN connectivity_links l ON (l.from_asset_id = b.node_id OR l.to_asset_id = b.node_id)
          JOIN telecom_assets next_asset ON (
            next_asset.id = CASE WHEN l.from_asset_id = b.node_id THEN l.to_asset_id ELSE l.from_asset_id END
          )
          WHERE next_asset.is_deleted = false 
            AND NOT (next_asset.id = ANY(b.visited_nodes))
            -- Stop traversing if we hit the endAssetId to avoid unnecessary iterations
            AND b.node_id <> $2
        )
        SELECT visited_nodes, visited_routes, path_length_m 
        FROM path_finder 
        WHERE node_id = $2
        ORDER BY path_length_m ASC
        LIMIT 1;
      `;
      const pathRes = await client.query(pathQuery, [startAssetId, endAssetId]);

      if (pathRes.rows.length === 0) {
        throw new Error('No path found between the selected assets');
      }

      const shortest = pathRes.rows[0];
      const traceOutput = await formatTraceResult(client, shortest.visited_nodes, shortest.visited_routes);

      return {
        pathLengthMeters: parseFloat(shortest.path_length_m),
        ...traceOutput
      };
    });

    res.json(result);
  } catch (err) {
    console.error('shortestPath error:', err.message);
    res.status(500).json({ message: 'Shortest path analysis failed: ' + err.message });
  }
};

// SERVICE IMPACT ANALYSIS: What customers are cut if an asset/route goes down?
exports.serviceImpact = async (req, res) => {
  const { nodeType, id } = req.body; // nodeType is either 'asset' (node) or 'route' (cable segment)

  if (!nodeType || !id) {
    return res.status(400).json({ message: 'nodeType and id are required' });
  }

  try {
    const result = await db.transaction(async (client) => {
      let rootNodesToCut = [];
      let routeIdToCut = null;

      if (nodeType === 'asset') {
        rootNodesToCut.push(id);
      } else {
        routeIdToCut = id;
        // If route is cut, we look at the endpoints of the route that are affected.
        // We find the nodes connected to this route_id.
        const endpointsRes = await client.query('SELECT from_asset_id, to_asset_id FROM connectivity_links WHERE route_id = $1', [id]);
        endpointsRes.rows.forEach(r => {
          rootNodesToCut.push(r.from_asset_id);
          rootNodesToCut.push(r.to_asset_id);
        });
      }

      if (rootNodesToCut.length === 0) {
        return {
          affectedCustomers: [],
          totalCustomersCut: 0,
          cutDetails: 'No active connections associated with this resource.'
        };
      }

      // Step 1: Run Downstream Trace starting from the cut nodes
      // However, we want to trace downstream towards customers to see who is isolated.
      // To determine who is cut, let's find all customers reachable downstream from the cut points.
      // Wait, in a telecom network, the customer ONT is downstream. If we trace downstream from the cut nodes, 
      // all customers reached are impacted!
      const impactQuery = `
        WITH RECURSIVE downstream_impact AS (
          SELECT 
            id AS node_id,
            asset_type,
            ARRAY[id] AS visited_nodes
          FROM telecom_assets
          WHERE id = ANY($1) AND is_deleted = false

          UNION ALL

          SELECT 
            next_asset.id AS node_id,
            next_asset.asset_type,
            b.visited_nodes || next_asset.id
          FROM downstream_impact b
          JOIN connectivity_links l ON (l.from_asset_id = b.node_id OR l.to_asset_id = b.node_id)
          JOIN telecom_assets next_asset ON (
            next_asset.id = CASE WHEN l.from_asset_id = b.node_id THEN l.to_asset_id ELSE l.from_asset_id END
          )
          -- Don't trace through the cut route if route was specified
          WHERE next_asset.is_deleted = false 
            AND NOT (next_asset.id = ANY(b.visited_nodes))
            AND (l.route_id IS NULL OR l.route_id <> $2)
            AND next_asset.asset_type <> 'olt' -- Do not trace backwards to feed sources
        )
        SELECT DISTINCT a.id, a.name, a.asset_type, a.status, ST_AsGeoJSON(a.geom)::json AS geom_json
        FROM downstream_impact d
        JOIN telecom_assets a ON d.node_id = a.id
        WHERE a.asset_type IN ('customer', 'ont') AND a.is_deleted = false;
      `;
      
      const impactRes = await client.query(impactQuery, [rootNodesToCut, routeIdToCut]);
      const customerFeatures = impactRes.rows.map(row => ({
        type: 'Feature',
        geometry: row.geom_json,
        properties: {
          id: row.id,
          name: row.name,
          asset_type: row.asset_type,
          status: row.status
        }
      }));

      return {
        affectedCustomers: {
          type: 'FeatureCollection',
          features: customerFeatures
        },
        totalCustomersCut: customerFeatures.length,
        cutDetails: `Simulating cut at ${nodeType === 'asset' ? 'Asset ID ' + id : 'Cable route ID ' + id}.`
      };
    });

    res.json(result);
  } catch (err) {
    console.error('serviceImpact error:', err.message);
    res.status(500).json({ message: 'Service impact analysis failed: ' + err.message });
  }
};

// FIBER UTILIZATION: Cable statistics (utilized vs free)
exports.utilizationSummary = async (req, res) => {
  try {
    const summaryQuery = `
      SELECT 
        r.id, r.name, r.route_type, r.length_meters,
        COALESCE((r.additional_attributes->>'fiber_count')::int, 0) AS total_fibers,
        COUNT(l.id) AS active_connections
      FROM telecom_routes r
      LEFT JOIN connectivity_links l ON r.id = l.route_id
      WHERE r.route_type = 'fiber_cable' AND r.is_deleted = false
      GROUP BY r.id
    `;
    const result = await db.query(summaryQuery);
    
    const detailedList = result.rows.map(row => {
      const active = parseInt(row.active_connections);
      const total = parseInt(row.total_fibers) || 12; // default if not specified
      const utilizationPercent = total > 0 ? parseFloat(((active / total) * 100).toFixed(1)) : 0;
      return {
        id: row.id,
        name: row.name,
        lengthMeters: parseFloat(row.length_meters || 0),
        totalFibers: total,
        activeFibers: active,
        utilizationPercent
      };
    });

    res.json(detailedList);
  } catch (err) {
    console.error('utilizationSummary error:', err.message);
    res.status(500).json({ message: 'Failed to retrieve utilization summary' });
  }
};
