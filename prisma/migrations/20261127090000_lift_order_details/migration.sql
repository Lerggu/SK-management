-- Lift and resource order details (docs/adr/0036-lift-order-details.md):
-- lift radius, lifting accessories, extra crew (riggers and others) and the
-- responsible person on site. The heaviest piece is the existing weight_kg.

-- AlterTable
ALTER TABLE "logistics_requests" ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "contact_name" TEXT,
ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "extra_crew" TEXT,
ADD COLUMN     "lift_radius_m" DECIMAL(5,1),
ADD COLUMN     "lifting_accessories" TEXT,
ADD COLUMN     "rigger_count" INTEGER;

ALTER TABLE logistics_requests
  ADD CONSTRAINT logistics_requests_lift_radius CHECK (lift_radius_m IS NULL OR lift_radius_m > 0),
  ADD CONSTRAINT logistics_requests_rigger_count CHECK (rigger_count IS NULL OR rigger_count BETWEEN 0 AND 50);
