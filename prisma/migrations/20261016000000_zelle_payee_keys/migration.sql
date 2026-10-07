-- Zelle payments used to share one merchant key ("ZELLE TO" or "ZELLE FROM") whoever they
-- were with, so sorting one could sort all of them. New imports key them by person; the
-- old shared keys are cleared so they no longer group or teach categories.
UPDATE `Transaction` SET `payeeKey` = NULL WHERE `payeeKey` IN ('ZELLE TO', 'ZELLE FROM');
