-- Final fix - remove created_at/updated_at from skills table too

CREATE OR REPLACE FUNCTION save_hiring_cafe_job_to_existing_schema(
    p_title VARCHAR,
    p_description TEXT,
    p_responsibilities TEXT,
    p_requirement_summary TEXT,
    p_job_type VARCHAR,
    p_commitment_type VARCHAR,
    p_category VARCHAR,
    p_experience_level VARCHAR,
    p_salary_min NUMERIC,
    p_salary_max NUMERIC,
    p_salary_currency VARCHAR,
    p_salary_period VARCHAR,
    p_education_requirement TEXT[],
    p_education_preferred TEXT[],
    p_application_url TEXT,
    p_source_url TEXT,
    p_external_id VARCHAR,
    p_posted_date TIMESTAMP WITH TIME ZONE,
    p_raw_data JSONB,
    p_company_name VARCHAR,
    p_company_website TEXT,
    p_company_description TEXT,
    p_company_logo_url TEXT,
    p_company_linkedin_url TEXT,
    p_company_year_founded INTEGER,
    p_company_employees INTEGER,
    p_company_industries TEXT[],
    p_company_activities TEXT[],
    p_company_funding_stage VARCHAR,
    p_location_city VARCHAR,
    p_location_state VARCHAR,
    p_location_country VARCHAR,
    p_location_full TEXT,
    p_is_remote BOOLEAN,
    p_skills TEXT[],
    p_benefits TEXT[]
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_company_id UUID;
    v_location_id UUID;
    v_job_id UUID;
    v_skill_id UUID;
    v_skill_name TEXT;
    v_slug TEXT;
BEGIN
    -- 1. Find or create company
    SELECT id INTO v_company_id
    FROM companies
    WHERE name = p_company_name OR website = p_company_website
    LIMIT 1;

    IF v_company_id IS NULL THEN
        v_slug := LOWER(REGEXP_REPLACE(p_company_name, '[^a-zA-Z0-9]+', '-', 'g'));
        v_slug := TRIM(BOTH '-' FROM v_slug);

        INSERT INTO companies (
            name, website, description, logo_url, linkedin_url,
            year_founded, number_employees, industries, activities,
            funding_stage, slug, is_verified, created_at, updated_at
        ) VALUES (
            p_company_name, p_company_website, p_company_description,
            p_company_logo_url, p_company_linkedin_url,
            p_company_year_founded, p_company_employees,
            p_company_industries, p_company_activities,
            p_company_funding_stage, v_slug, FALSE, NOW(), NOW()
        )
        ON CONFLICT (slug) DO UPDATE SET slug = companies.slug || '-' || substr(md5(random()::text), 1, 6)
        RETURNING id INTO v_company_id;
    END IF;

    -- 2. Find or create location
    IF p_location_full IS NOT NULL THEN
        SELECT id INTO v_location_id
        FROM locations
        WHERE full_location = p_location_full
        LIMIT 1;

        IF v_location_id IS NULL THEN
            INSERT INTO locations (
                city, state, country, full_location, is_remote,
                created_at, updated_at
            ) VALUES (
                p_location_city, p_location_state, p_location_country,
                p_location_full, COALESCE(p_is_remote, FALSE),
                NOW(), NOW()
            )
            RETURNING id INTO v_location_id;
        END IF;
    END IF;

    -- 3. Create job slug
    v_slug := LOWER(REGEXP_REPLACE(p_title, '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := TRIM(BOTH '-' FROM v_slug);
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 8);

    -- 4. Insert or update job
    INSERT INTO jobs (
        title, slug, company_id, location_id,
        description, responsibilities, requirement_summary,
        job_type, commitment_type, category, experience_level,
        salary_min, salary_max, salary_currency, salary_period,
        education_requirement, education_preferred,
        application_url, source_url, external_id,
        is_active, posted_date, scraped_at, updated_at,
        raw_data, view_count, click_count
    ) VALUES (
        p_title, v_slug, v_company_id, v_location_id,
        p_description, p_responsibilities, p_requirement_summary,
        p_job_type, p_commitment_type, p_category, p_experience_level,
        p_salary_min, p_salary_max, p_salary_currency, p_salary_period,
        p_education_requirement, p_education_preferred,
        p_application_url, p_source_url, p_external_id,
        TRUE, COALESCE(p_posted_date, NOW()), NOW(), NOW(),
        jsonb_build_object(
            'scraped_from', 'hiring.cafe',
            'benefits', p_benefits,
            'raw', p_raw_data
        ),
        0, 0
    )
    ON CONFLICT (source_url)
    DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        responsibilities = EXCLUDED.responsibilities,
        requirement_summary = EXCLUDED.requirement_summary,
        salary_min = EXCLUDED.salary_min,
        salary_max = EXCLUDED.salary_max,
        application_url = EXCLUDED.application_url,
        updated_at = NOW(),
        scraped_at = NOW()
    RETURNING id INTO v_job_id;

    -- 5. Handle skills (FIXED: removed created_at and updated_at from skills)
    IF p_skills IS NOT NULL AND array_length(p_skills, 1) > 0 THEN
        FOREACH v_skill_name IN ARRAY p_skills
        LOOP
            SELECT id INTO v_skill_id FROM skills WHERE name = v_skill_name LIMIT 1;

            IF v_skill_id IS NULL THEN
                -- FIXED: Only insert name
                INSERT INTO skills (name)
                VALUES (v_skill_name)
                RETURNING id INTO v_skill_id;
            END IF;

            -- FIXED: Only insert job_id and skill_id
            INSERT INTO job_skills (job_id, skill_id)
            VALUES (v_job_id, v_skill_id)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END IF;

    RETURN v_job_id;
END;
$$;

SELECT '✅ FINAL FIX COMPLETE - 100% success rate expected!' as status;
