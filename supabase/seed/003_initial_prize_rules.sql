-- Seed: jurisdictions + prize rule sets + tiers for Ontario (CA-ON) as template
-- One jurisdiction per game; NATIONAL fallback

-- Jurisdictions (sample)
INSERT INTO jurisdictions (country, code, name, currency, timezone) VALUES
('CA', 'ON', 'Ontario', 'CAD', 'America/Toronto'),
('CA', 'AB', 'Alberta', 'CAD', 'America/Edmonton'),
('US', 'CA', 'California', 'USD', 'America/Los_Angeles'),
('US', 'NY', 'New York', 'USD', 'America/New_York'),
('CA', 'NATIONAL', 'National (Canada)', 'CAD', 'America/Toronto'),
('US', 'NATIONAL', 'National (USA)', 'USD', 'America/New_York')
ON CONFLICT (country, code) DO NOTHING;

-- Lottery games (map to existing lotteries)
INSERT INTO lottery_games (game_code, name, number_rules_json) VALUES
('lotto_max', 'Lotto Max', '{"main_count":7,"main_max":50,"special_count":1,"special_max":50}'),
('lotto_649', 'Lotto 6/49', '{"main_count":6,"main_max":49,"special_count":1,"special_max":49}'),
('powerball', 'Powerball', '{"main_count":5,"main_max":69,"special_count":1,"special_max":26}'),
('mega_millions', 'Mega Millions', '{"main_count":5,"main_max":70,"special_count":1,"special_max":25}')
ON CONFLICT (game_code) DO NOTHING;

-- Prize rule set: Lotto Max Ontario
INSERT INTO prize_rule_sets (game_code, jurisdiction_code, version, effective_from, official_rules_url, claim_url, is_active) VALUES
('lotto_max', 'CA-ON', '1.0', '2020-01-01', 'https://www.olg.ca/en/lottery/play-lotto-max-encore.html', 'https://www.olg.ca/en/lottery/claim-prizes.html', true);

INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Jackpot', 7, 1, 'PARI_MUTUEL', NULL, 'CAD', false, 0 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 7', 7, 0, 'PARI_MUTUEL', NULL, 'CAD', false, 1 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 6 + Bonus', 6, 1, 'PARI_MUTUEL', NULL, 'CAD', false, 2 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 6', 6, 0, 'PARI_MUTUEL', NULL, 'CAD', false, 3 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 5 + Bonus', 5, 1, 'PARI_MUTUEL', NULL, 'CAD', false, 4 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 5', 5, 0, 'PARI_MUTUEL', NULL, 'CAD', false, 5 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 4 + Bonus', 4, 1, 'PARI_MUTUEL', NULL, 'CAD', false, 6 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 4', 4, 0, 'FIXED', 20, 'CAD', false, 7 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 3 + Bonus', 3, 1, 'FIXED', 20, 'CAD', false, 8 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 3', 3, 0, 'FREE_PLAY', NULL, 'CAD', false, 9 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-ON' LIMIT 1;

-- Lotto Max / 6/49 CA-NATIONAL fallback (used when jurisdiction is NATIONAL)
INSERT INTO prize_rule_sets (game_code, jurisdiction_code, version, effective_from, official_rules_url, claim_url, is_active) VALUES
('lotto_max', 'CA-NATIONAL', '1.0', '2020-01-01', 'https://www.olg.ca/en/lottery/play-lotto-max-encore.html', 'https://www.olg.ca/en/lottery/claim-prizes.html', true),
('lotto_649', 'CA-NATIONAL', '1.0', '2020-01-01', 'https://www.olg.ca/en/lottery/play-lotto-649-encore.html', 'https://www.olg.ca/en/lottery/claim-prizes.html', true);

INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Jackpot', 7, 1, 'PARI_MUTUEL', NULL, 'CAD', false, 0 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 7', 7, 0, 'PARI_MUTUEL', NULL, 'CAD', false, 1 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 6 + Bonus', 6, 1, 'PARI_MUTUEL', NULL, 'CAD', false, 2 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 6', 6, 0, 'PARI_MUTUEL', NULL, 'CAD', false, 3 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 5 + Bonus', 5, 1, 'PARI_MUTUEL', NULL, 'CAD', false, 4 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 5', 5, 0, 'PARI_MUTUEL', NULL, 'CAD', false, 5 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 4 + Bonus', 4, 1, 'PARI_MUTUEL', NULL, 'CAD', false, 6 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 4', 4, 0, 'FIXED', 20, 'CAD', false, 7 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 3 + Bonus', 3, 1, 'FIXED', 20, 'CAD', false, 8 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 3', 3, 0, 'FREE_PLAY', NULL, 'CAD', false, 9 FROM prize_rule_sets WHERE game_code='lotto_max' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;

INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Jackpot', 6, 0, 'PARI_MUTUEL', NULL, 'CAD', false, 0 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 5 + Bonus', 5, 1, 'PARI_MUTUEL', NULL, 'CAD', false, 1 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 5', 5, 0, 'PARI_MUTUEL', NULL, 'CAD', false, 2 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 4', 4, 0, 'PARI_MUTUEL', NULL, 'CAD', false, 3 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 3 + Bonus', 3, 1, 'FIXED', 10, 'CAD', false, 4 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 3', 3, 0, 'FIXED', 10, 'CAD', false, 5 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 2 + Bonus', 2, 1, 'FIXED', 5, 'CAD', false, 6 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 2', 2, 0, 'FREE_PLAY', NULL, 'CAD', false, 7 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-NATIONAL' LIMIT 1;

-- Lotto 6/49 Ontario
INSERT INTO prize_rule_sets (game_code, jurisdiction_code, version, effective_from, official_rules_url, claim_url, is_active) VALUES
('lotto_649', 'CA-ON', '1.0', '2020-01-01', 'https://www.olg.ca/en/lottery/play-lotto-649-encore.html', 'https://www.olg.ca/en/lottery/claim-prizes.html', true);

INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Jackpot', 6, 0, 'PARI_MUTUEL', NULL, 'CAD', false, 0 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 5 + Bonus', 5, 1, 'PARI_MUTUEL', NULL, 'CAD', false, 1 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 5', 5, 0, 'PARI_MUTUEL', NULL, 'CAD', false, 2 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 4', 4, 0, 'PARI_MUTUEL', NULL, 'CAD', false, 3 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 3 + Bonus', 3, 1, 'FIXED', 10, 'CAD', false, 4 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 3', 3, 0, 'FIXED', 10, 'CAD', false, 5 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 2 + Bonus', 2, 1, 'FIXED', 5, 'CAD', false, 6 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-ON' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 2', 2, 0, 'FREE_PLAY', NULL, 'CAD', false, 7 FROM prize_rule_sets WHERE game_code='lotto_649' AND jurisdiction_code='CA-ON' LIMIT 1;

-- Powerball National (USA)
INSERT INTO prize_rule_sets (game_code, jurisdiction_code, version, effective_from, official_rules_url, claim_url, is_active) VALUES
('powerball', 'US-NATIONAL', '1.0', '2020-01-01', 'https://www.powerball.com/', 'https://www.powerball.com/', true);

INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Jackpot', 5, 1, 'PARI_MUTUEL', NULL, 'USD', false, 0 FROM prize_rule_sets WHERE game_code='powerball' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 5', 5, 0, 'FIXED', 1000000, 'USD', true, 1 FROM prize_rule_sets WHERE game_code='powerball' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 4 + Powerball', 4, 1, 'FIXED', 50000, 'USD', true, 2 FROM prize_rule_sets WHERE game_code='powerball' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 4', 4, 0, 'FIXED', 100, 'USD', true, 3 FROM prize_rule_sets WHERE game_code='powerball' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 3 + Powerball', 3, 1, 'FIXED', 100, 'USD', true, 4 FROM prize_rule_sets WHERE game_code='powerball' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 3', 3, 0, 'FIXED', 7, 'USD', true, 5 FROM prize_rule_sets WHERE game_code='powerball' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 2 + Powerball', 2, 1, 'FIXED', 7, 'USD', true, 6 FROM prize_rule_sets WHERE game_code='powerball' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 1 + Powerball', 1, 1, 'FIXED', 4, 'USD', true, 7 FROM prize_rule_sets WHERE game_code='powerball' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Powerball only', 0, 1, 'FIXED', 4, 'USD', true, 8 FROM prize_rule_sets WHERE game_code='powerball' AND jurisdiction_code='US-NATIONAL' LIMIT 1;

-- Mega Millions National
INSERT INTO prize_rule_sets (game_code, jurisdiction_code, version, effective_from, official_rules_url, claim_url, is_active) VALUES
('mega_millions', 'US-NATIONAL', '1.0', '2020-01-01', 'https://www.megamillions.com/', 'https://www.megamillions.com/', true);

INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Jackpot', 5, 1, 'PARI_MUTUEL', NULL, 'USD', false, 0 FROM prize_rule_sets WHERE game_code='mega_millions' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 5', 5, 0, 'FIXED', 1000000, 'USD', true, 1 FROM prize_rule_sets WHERE game_code='mega_millions' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 4 + Mega', 4, 1, 'FIXED', 10000, 'USD', true, 2 FROM prize_rule_sets WHERE game_code='mega_millions' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 4', 4, 0, 'FIXED', 500, 'USD', true, 3 FROM prize_rule_sets WHERE game_code='mega_millions' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 3 + Mega', 3, 1, 'FIXED', 200, 'USD', true, 4 FROM prize_rule_sets WHERE game_code='mega_millions' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 3', 3, 0, 'FIXED', 10, 'USD', true, 5 FROM prize_rule_sets WHERE game_code='mega_millions' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 2 + Mega', 2, 1, 'FIXED', 10, 'USD', true, 6 FROM prize_rule_sets WHERE game_code='mega_millions' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Match 1 + Mega', 1, 1, 'FIXED', 4, 'USD', true, 7 FROM prize_rule_sets WHERE game_code='mega_millions' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
INSERT INTO prize_tiers (rule_set_id, tier_name, match_main, match_special, prize_type, prize_amount, prize_currency, multiplier_applicable, sort_order)
SELECT id, 'Mega only', 0, 1, 'FIXED', 2, 'USD', true, 8 FROM prize_rule_sets WHERE game_code='mega_millions' AND jurisdiction_code='US-NATIONAL' LIMIT 1;
