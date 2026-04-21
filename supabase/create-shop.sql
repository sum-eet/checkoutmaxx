CREATE OR REPLACE FUNCTION create_shop(p_shop_domain TEXT, p_access_token TEXT)
RETURNS TABLE(id UUID) AS $$
DECLARE new_id UUID := gen_random_uuid();
BEGIN
  UPDATE "Shop" SET "isActive" = false, "updatedAt" = now()
  WHERE "shopDomain" = p_shop_domain AND "isActive" = true;

  INSERT INTO "Shop" (id, "shopDomain", "accessToken", "isActive", "installedAt", "updatedAt")
  VALUES (new_id, p_shop_domain, p_access_token, true, now(), now());

  RETURN QUERY SELECT new_id;
END;
$$ LANGUAGE plpgsql;
