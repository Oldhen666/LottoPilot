-- Add-on catalog seed: WCLC EXTRA, OLG ENCORE, ALC TAG, Powerball Power Play/Double Play, 6/49 Gold Ball, Lotto Max Maxmillions, Mega multiplier

-- WCLC (AB, SK, MB): Lotto Max + EXTRA
INSERT INTO add_on_catalog (game_code, jurisdiction_code, add_on_code, add_on_type, input_schema_json, rules_schema_json, official_rules_url, claim_url, is_enabled) VALUES
('lotto_max', 'CA-AB', 'EXTRA', 'INDEPENDENT_NUMBER', '{"digits":7,"userInput":true,"multipleGroups":false}', '{"matchDirection":"rightToLeft","tiers":[{"matchedDigits":7,"prize":"Jackpot"},{"matchedDigits":6,"prize":"$100"},{"matchedDigits":5,"prize":"$20"},{"matchedDigits":4,"prize":"$5"},{"matchedDigits":3,"prize":"$2"}]}', 'https://www.wclc.com/extra.htm', 'https://www.wclc.com/', true),
('lotto_max', 'CA-SK', 'EXTRA', 'INDEPENDENT_NUMBER', '{"digits":7,"userInput":true,"multipleGroups":false}', '{"matchDirection":"rightToLeft","tiers":[{"matchedDigits":7,"prize":"Jackpot"},{"matchedDigits":6,"prize":"$100"},{"matchedDigits":5,"prize":"$20"},{"matchedDigits":4,"prize":"$5"},{"matchedDigits":3,"prize":"$2"}]}', 'https://www.wclc.com/extra.htm', 'https://www.wclc.com/', true),
('lotto_max', 'CA-MB', 'EXTRA', 'INDEPENDENT_NUMBER', '{"digits":7,"userInput":true,"multipleGroups":false}', '{"matchDirection":"rightToLeft","tiers":[{"matchedDigits":7,"prize":"Jackpot"},{"matchedDigits":6,"prize":"$100"},{"matchedDigits":5,"prize":"$20"},{"matchedDigits":4,"prize":"$5"},{"matchedDigits":3,"prize":"$2"}]}', 'https://www.wclc.com/extra.htm', 'https://www.wclc.com/', true),
('lotto_max', 'CA-AB', 'MAXMILLIONS', 'BUILT_IN_COMPONENT', '{"userInput":true,"multipleGroups":true}', '{"matchType":"exact7"}', 'https://www.wclc.com/lotto-max.htm', 'https://www.wclc.com/', true),
('lotto_max', 'CA-SK', 'MAXMILLIONS', 'BUILT_IN_COMPONENT', '{"userInput":true,"multipleGroups":true}', '{"matchType":"exact7"}', 'https://www.wclc.com/lotto-max.htm', 'https://www.wclc.com/', true),
('lotto_max', 'CA-MB', 'MAXMILLIONS', 'BUILT_IN_COMPONENT', '{"userInput":true,"multipleGroups":true}', '{"matchType":"exact7"}', 'https://www.wclc.com/lotto-max.htm', 'https://www.wclc.com/', true);

-- OLG (ON): Lotto Max + ENCORE, Lotto 6/49 + ENCORE
INSERT INTO add_on_catalog (game_code, jurisdiction_code, add_on_code, add_on_type, input_schema_json, rules_schema_json, official_rules_url, claim_url, is_enabled) VALUES
('lotto_max', 'CA-ON', 'ENCORE', 'INDEPENDENT_NUMBER', '{"digits":7,"userInput":true,"multipleGroups":false}', '{"matchDirection":"rightToLeft","tiers":[{"matchedDigits":7,"prize":"$1M"},{"matchedDigits":6,"prize":"$1000"},{"matchedDigits":5,"prize":"$100"},{"matchedDigits":4,"prize":"$10"},{"matchedDigits":3,"prize":"$2"}]}', 'https://www.olg.ca/en/lottery/play-encore.html', 'https://www.olg.ca/en/lottery/claim-prizes.html', true),
('lotto_649', 'CA-ON', 'ENCORE', 'INDEPENDENT_NUMBER', '{"digits":7,"userInput":true,"multipleGroups":false}', '{"matchDirection":"rightToLeft","tiers":[{"matchedDigits":7,"prize":"$1M"},{"matchedDigits":6,"prize":"$1000"},{"matchedDigits":5,"prize":"$100"},{"matchedDigits":4,"prize":"$10"},{"matchedDigits":3,"prize":"$2"}]}', 'https://www.olg.ca/en/lottery/play-encore.html', 'https://www.olg.ca/en/lottery/claim-prizes.html', true),
('lotto_649', 'CA-ON', 'GOLD_BALL', 'BUILT_IN_COMPONENT', '{}', '{"matchType":"exact"}', 'https://www.olg.ca/en/lottery/play-lotto-649-encore.html', 'https://www.olg.ca/en/lottery/claim-prizes.html', true);

-- ALC (Atlantic): TAG - 6 digits, nightly. Associate with lotto_max and lotto_649 for tickets bought together
INSERT INTO add_on_catalog (game_code, jurisdiction_code, add_on_code, add_on_type, input_schema_json, rules_schema_json, official_rules_url, claim_url, is_enabled) VALUES
('lotto_max', 'CA-NB', 'TAG', 'INDEPENDENT_NUMBER', '{"digits":6,"userInput":true,"tagDrawDateOptional":true}', '{"matchType":"position","tiers":[{"matchedDigits":6,"prize":"Jackpot"},{"matchedDigits":5,"prize":"$1000"},{"matchedDigits":4,"prize":"$100"},{"matchedDigits":3,"prize":"$20"},{"matchedDigits":2,"prize":"$10"},{"matchedDigits":1,"prize":"$2"}]}', 'https://alc.ca/content/alc/en/our-games/lotto/tag.html', 'https://atlanticlottery.com/', true),
('lotto_max', 'CA-NS', 'TAG', 'INDEPENDENT_NUMBER', '{"digits":6,"userInput":true,"tagDrawDateOptional":true}', '{"matchType":"position","tiers":[{"matchedDigits":6,"prize":"Jackpot"},{"matchedDigits":5,"prize":"$1000"},{"matchedDigits":4,"prize":"$100"},{"matchedDigits":3,"prize":"$20"},{"matchedDigits":2,"prize":"$10"},{"matchedDigits":1,"prize":"$2"}]}', 'https://alc.ca/content/alc/en/our-games/lotto/tag.html', 'https://atlanticlottery.com/', true),
('lotto_649', 'CA-NB', 'TAG', 'INDEPENDENT_NUMBER', '{"digits":6,"userInput":true,"tagDrawDateOptional":true}', '{"matchType":"position","tiers":[{"matchedDigits":6,"prize":"Jackpot"},{"matchedDigits":5,"prize":"$1000"},{"matchedDigits":4,"prize":"$100"},{"matchedDigits":3,"prize":"$20"},{"matchedDigits":2,"prize":"$10"},{"matchedDigits":1,"prize":"$2"}]}', 'https://alc.ca/content/alc/en/our-games/lotto/tag.html', 'https://atlanticlottery.com/', true),
('lotto_649', 'CA-NS', 'TAG', 'INDEPENDENT_NUMBER', '{"digits":6,"userInput":true,"tagDrawDateOptional":true}', '{"matchType":"position","tiers":[{"matchedDigits":6,"prize":"Jackpot"},{"matchedDigits":5,"prize":"$1000"},{"matchedDigits":4,"prize":"$100"},{"matchedDigits":3,"prize":"$20"},{"matchedDigits":2,"prize":"$10"},{"matchedDigits":1,"prize":"$2"}]}', 'https://alc.ca/content/alc/en/our-games/lotto/tag.html', 'https://atlanticlottery.com/', true);

-- Powerball: Power Play, Double Play (US jurisdictions)
INSERT INTO add_on_catalog (game_code, jurisdiction_code, add_on_code, add_on_type, input_schema_json, rules_schema_json, official_rules_url, claim_url, is_enabled) VALUES
('powerball', 'US-NATIONAL', 'POWER_PLAY', 'MULTIPLIER', '{"userCheckbox":true}', '{"appliesToNonJackpot":true,"multipliers":[2,3,4,5,10]}', 'https://www.powerball.com/', 'https://www.powerball.com/', true),
('powerball', 'US-NY', 'POWER_PLAY', 'MULTIPLIER', '{"userCheckbox":true}', '{"appliesToNonJackpot":true,"multipliers":[2,3,4,5,10]}', 'https://www.powerball.com/', 'https://www.powerball.com/', true),
('powerball', 'US-CA', 'POWER_PLAY', 'MULTIPLIER', '{"userCheckbox":true}', '{"appliesToNonJackpot":true,"multipliers":[2,3,4,5,10]}', 'https://www.powerball.com/', 'https://www.powerball.com/', true),
('powerball', 'US-NATIONAL', 'DOUBLE_PLAY', 'INDEPENDENT_DRAW', '{"userCheckbox":true}', '{"matchLogic":"sameAsMain"}', 'https://www.powerball.com/', 'https://www.powerball.com/', true),
('powerball', 'US-NY', 'DOUBLE_PLAY', 'INDEPENDENT_DRAW', '{"userCheckbox":true}', '{"matchLogic":"sameAsMain"}', 'https://www.powerball.com/', 'https://www.powerball.com/', true),
('powerball', 'US-CA', 'DOUBLE_PLAY', 'INDEPENDENT_DRAW', '{"userCheckbox":true}', '{"matchLogic":"sameAsMain"}', 'https://www.powerball.com/', 'https://www.powerball.com/', true);

-- Mega Millions: built-in multiplier (2025+ Megaplier retired in some states; show when available)
INSERT INTO add_on_catalog (game_code, jurisdiction_code, add_on_code, add_on_type, input_schema_json, rules_schema_json, official_rules_url, claim_url, is_enabled) VALUES
('mega_millions', 'US-NATIONAL', 'MEGA_MULTIPLIER', 'BUILT_IN_COMPONENT', '{}', '{"appliesToNonJackpot":true}', 'https://www.megamillions.com/', 'https://www.megamillions.com/', true),
('mega_millions', 'US-NY', 'MEGA_MULTIPLIER', 'BUILT_IN_COMPONENT', '{}', '{"appliesToNonJackpot":true}', 'https://www.megamillions.com/', 'https://www.megamillions.com/', true),
('mega_millions', 'US-CA', 'MEGA_MULTIPLIER', 'BUILT_IN_COMPONENT', '{}', '{"appliesToNonJackpot":true}', 'https://www.megamillions.com/', 'https://www.megamillions.com/', true);

-- Fallback: CA-ON Lotto Max Maxmillions, 6/49 Gold Ball for other provinces
INSERT INTO add_on_catalog (game_code, jurisdiction_code, add_on_code, add_on_type, input_schema_json, rules_schema_json, official_rules_url, claim_url, is_enabled) VALUES
('lotto_max', 'CA-ON', 'MAXMILLIONS', 'BUILT_IN_COMPONENT', '{"userInput":true,"multipleGroups":true}', '{"matchType":"exact7"}', 'https://www.olg.ca/en/lottery/play-lotto-max-encore.html', 'https://www.olg.ca/en/lottery/claim-prizes.html', true)
ON CONFLICT (game_code, jurisdiction_code, add_on_code) DO NOTHING;
