-- Marketing (ADR 0032 addendum): companies whose news the discovery agent follows on every run.
-- Names are search hints only and editable in the marketing settings.

-- AlterTable
ALTER TABLE "marketing_settings" ADD COLUMN     "watch_companies" TEXT[] DEFAULT ARRAY['Google', 'Microsoft', 'Amazon Web Services', 'Meta', 'Equinix', 'Digital Realty', 'atNorth', 'Verne', 'Polarnode', 'Hyperco', 'Yondr', 'EcoDataCenter', 'Conapto', 'Bulk Infrastructure', 'Green Mountain', 'Brookfield', 'Fortum', 'Elisa', 'Telia', 'Vattenfall', 'Fingrid', 'Svenska kraftnät']::TEXT[];


ALTER TABLE marketing_settings ADD CONSTRAINT marketing_settings_watch_companies CHECK (cardinality(watch_companies) <= 60);
