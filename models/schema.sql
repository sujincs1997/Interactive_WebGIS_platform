-- Enable PostGIS Extension if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Users Table (Authentication)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'planner', -- 'admin', 'planner', 'viewer'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Telecom Assets Table (Points: Poles, Manholes, OLTs, Cabinets, Splitters, Joints, Customers, Towers)
CREATE TABLE IF NOT EXISTS telecom_assets (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    asset_type VARCHAR(50) NOT NULL, -- 'pole', 'manhole', 'cabinet', 'tower', 'customer', 'joint_closure', 'splitter', 'olt', 'ont'
    geom GEOMETRY(Point, 4326) NOT NULL,
    status VARCHAR(50) DEFAULT 'Planned', -- 'Planned', 'Under Construction', 'Active', 'Maintenance', 'Retired'
    owner VARCHAR(100) DEFAULT 'Company',
    installation_date DATE DEFAULT CURRENT_DATE,
    remarks TEXT,
    additional_attributes JSONB DEFAULT '{}'::jsonb, -- e.g. fiber_capacity, model, port_count, height, etc.
    is_deleted BOOLEAN DEFAULT FALSE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Geospatial index for Assets
CREATE INDEX IF NOT EXISTS idx_telecom_assets_geom ON telecom_assets USING gist(geom);
CREATE INDEX IF NOT EXISTS idx_telecom_assets_type ON telecom_assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_telecom_assets_is_deleted ON telecom_assets(is_deleted);

-- 3. Telecom Routes Table (LineStrings: Fiber Cables, Duct Routes)
CREATE TABLE IF NOT EXISTS telecom_routes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    route_type VARCHAR(50) NOT NULL, -- 'fiber_cable', 'duct'
    geom GEOMETRY(LineString, 4326) NOT NULL,
    status VARCHAR(50) DEFAULT 'Planned', -- 'Planned', 'Under Construction', 'Active', 'Maintenance', 'Retired'
    owner VARCHAR(100) DEFAULT 'Company',
    installation_date DATE DEFAULT CURRENT_DATE,
    length_meters NUMERIC(10, 2),
    remarks TEXT,
    additional_attributes JSONB DEFAULT '{}'::jsonb, -- e.g. fiber_count, cable_type, duct_diameter, cores_used
    is_deleted BOOLEAN DEFAULT FALSE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Geospatial index for Routes
CREATE INDEX IF NOT EXISTS idx_telecom_routes_geom ON telecom_routes USING gist(geom);
CREATE INDEX IF NOT EXISTS idx_telecom_routes_type ON telecom_routes(route_type);
CREATE INDEX IF NOT EXISTS idx_telecom_routes_is_deleted ON telecom_routes(is_deleted);

-- Automatic calculation of length in meters using geography cast
CREATE OR REPLACE FUNCTION calculate_route_length()
RETURNS TRIGGER AS $$
BEGIN
    NEW.length_meters := ST_Length(NEW.geom::geography);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_calculate_route_length
BEFORE INSERT OR UPDATE OF geom ON telecom_routes
FOR EACH ROW
EXECUTE FUNCTION calculate_route_length();

-- 4. Topology / Connectivity Links Table (Relates Node Asset to Node Asset, optionally mapping to a Route segment)
CREATE TABLE IF NOT EXISTS connectivity_links (
    id SERIAL PRIMARY KEY,
    from_asset_id INTEGER NOT NULL REFERENCES telecom_assets(id) ON DELETE CASCADE,
    to_asset_id INTEGER NOT NULL REFERENCES telecom_assets(id) ON DELETE CASCADE,
    route_id INTEGER REFERENCES telecom_routes(id) ON DELETE SET NULL, -- optional associated physical cable
    link_type VARCHAR(50) NOT NULL, -- 'olt-cabinet', 'cabinet-joint', 'joint-splitter', 'splitter-customer', 'joint-joint', 'olt-joint'
    details JSONB DEFAULT '{}'::jsonb, -- splice mappings (e.g. { "from_port": 1, "to_port": 4, "fiber_color": "Blue" })
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_self_loop CHECK (from_asset_id <> to_asset_id)
);

CREATE INDEX IF NOT EXISTS idx_connectivity_from ON connectivity_links(from_asset_id);
CREATE INDEX IF NOT EXISTS idx_connectivity_to ON connectivity_links(to_asset_id);
CREATE INDEX IF NOT EXISTS idx_connectivity_route ON connectivity_links(route_id);

-- 5. Audit Trail / Edit History Table
CREATE TABLE IF NOT EXISTS edit_history (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL, -- 'telecom_assets', 'telecom_routes', 'connectivity_links'
    record_id INTEGER NOT NULL,
    action VARCHAR(20) NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE', 'RESTORE'
    old_data JSONB,
    new_data JSONB,
    changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_edit_history_table_record ON edit_history(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_edit_history_changed_at ON edit_history(changed_at);
