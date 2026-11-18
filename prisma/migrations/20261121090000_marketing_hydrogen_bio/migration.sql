-- Marketing (ADR 0032 addendum, owner request 2026-11-18): hydrogen / Power-to-X
-- and bio projects (biorefineries, biogas, bioenergy) as their own categories.
ALTER TYPE "MarketingCategory" ADD VALUE IF NOT EXISTS 'HYDROGEN';
ALTER TYPE "MarketingCategory" ADD VALUE IF NOT EXISTS 'BIO';
