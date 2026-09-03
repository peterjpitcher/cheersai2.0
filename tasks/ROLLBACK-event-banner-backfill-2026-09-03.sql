-- Rollback for the 2026-09-03 event banner backfill.
--
-- The backfill turned the automatic date strip back on for scheduled event
-- posts that lost it to the imported-artwork suppression shipped in aba5e5c
-- (25 Aug 2026). These 50 variant ids were captured immediately before the
-- update; every one of them held banner_enabled = false and a NULL
-- banner_text_override, so setting them back to false restores the exact
-- prior state. No other column was touched.
--
-- Run this only to undo that backfill.

UPDATE content_variants
SET banner_enabled = false
WHERE id IN (
  '0821529a-8ab0-4d34-873d-63ee7cb5cd07','0ac3f727-e019-4970-b6f8-2f3f9c44340c',
  '131d2787-2caf-4650-ad32-9e773e88e7ed','15c27551-73b8-4552-8127-3d30a309119a',
  '18654c52-0682-4167-b7c8-cdc313f0fd5b','188b79f3-69d8-432b-a290-9a9186634e92',
  '1de2f458-9759-40d4-9891-12689c847c05','247a84bf-bc3b-4bf2-944a-15f2e3381375',
  '34da2d04-f6b2-46d7-8b91-3269cf88c57c','38ff62a4-ed10-43a2-b222-5044541c9700',
  '44082ed0-bc7b-4c63-a445-2f4bcfef8b0b','4448dbb6-4e1a-415e-a499-83bbdc093fd1',
  '4850f29f-5d00-4765-ae5a-3d369baf4fb6','4a72825d-659b-406d-8f24-096b25926805',
  '4aa71d7d-fccb-49a6-81e2-1c9697b23cb1','4ab4ae69-0eab-43d0-a09f-8498ca143aa5',
  '4d33fc3d-51ae-4149-a9b1-54f482142c33','4e623844-27ef-4ae5-8aa9-c3fa039ea8fc',
  '5a9850fe-7954-4b4c-b88d-0c1fb44c0d5b','5baadeb9-c3c8-424c-999e-ec6c0beefb84',
  '5d3d2f7d-862e-4fa1-8420-99a3e4276be1','5ffa0ded-0501-4c8b-a395-e5cedb18c331',
  '6a9d8ad7-1c16-4a5a-ab8d-29c92fd40761','715a65f6-2255-417e-b7ea-e457259f3145',
  '7758a392-2daa-4cef-8651-2341f9d34bb8','7cc1e5e2-a8ac-4bb8-b897-dfbf10a13036',
  '824d49ec-af24-4e1f-8d09-194442dc2dad','89526723-a5a9-4a92-98ed-df7344bd9a65',
  '8d979c7a-87c8-4afc-b4b0-902e7cda5585','8f8a7e74-e934-4e76-8ea7-9da3f08243fb',
  'a2d3bebf-d7a4-4ee5-8641-9b1a03267031','a998f62a-4989-44ad-b593-c4727df4b1ab',
  'add94560-389a-4835-aab7-44c381269679','b08dcd6b-2f4f-43f5-99fc-8d7bb7b79d51',
  'b2727d4a-d2a3-4ba9-bf39-b4bcd73f7974','b7cbcc3c-0522-45a5-8fea-0a32816ad61a',
  'bcdcdb54-bd9d-4b6f-94b9-670b216ce92c','bd83a0e1-aad7-4fc6-8771-df251bc439e2',
  'bfbe419f-bc63-4580-af07-8ca3f0893007','c2997ad3-de6d-4ee4-95ec-95744997489d',
  'c3c4b925-4384-43c9-8152-a0660ce7db19','cc0921ef-6e4e-4157-8da3-69827e165c17',
  'dd8306cf-0b67-49b5-b2da-b4d5aac0107c','de75fbef-709b-4f83-9205-6a9f9c4b8141',
  'e36248a7-d9a6-4e43-932c-d165dc9b2ea0','ec4e2f42-7bd4-467e-811e-6b95a2d39868',
  'f6e88884-0531-4ed3-a4f3-4f1c585fd6cc','f7eb8392-4f8e-4f10-9d87-297a61992d49',
  'fa7ebf63-39cc-4ee5-ae22-6ba8a5d4595c','fd29c121-e921-4c04-988a-e18db148b4aa'
);
