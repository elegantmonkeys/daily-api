DO $$
BEGIN
    UPDATE  source

    SET     "moderationRequired" = true

    WHERE   type = 'squad'
    AND     "moderationRequired" != true
    AND     private IS FALSE;
END $$;
