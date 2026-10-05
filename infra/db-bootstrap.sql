-- One-time database setup on Azure Database for PostgreSQL (ADR 0024,
-- docs/DEPLOY_AZURE.md). Run as the server administrator, connected to the
-- `postgres` database, e.g. in Azure Cloud Shell:
--
--   psql "host=<server>.postgres.database.azure.com dbname=postgres user=<admin> sslmode=require" \
--        -v owner_password="<strong password>" -f infra/db-bootstrap.sql
--
-- Creates:
--   sk_owner  – the application's login; owns the database and its tables,
--               runs migrations (container start) and identity paths.
--   sk_app    – NOLOGIN role used for every company-scoped query under
--               row-level security (ADR 0022). sk_owner may SET ROLE to it.
\set ON_ERROR_STOP on

CREATE ROLE sk_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE sk_app NOLOGIN;
GRANT sk_app TO sk_owner WITH ADMIN OPTION;

-- PostgreSQL 16: the administrator must be able to SET ROLE sk_owner to make it the owner.
GRANT sk_owner TO CURRENT_USER;
CREATE DATABASE sk_management OWNER sk_owner;
REVOKE sk_owner FROM CURRENT_USER;
