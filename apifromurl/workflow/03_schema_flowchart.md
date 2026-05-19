# Schema & Data Flow

## 1. Schema Relationships

```mermaid
erDiagram
    companies {
        uuid id PK
        varchar name
        varchar slug
        text website
        text logo_url
        text description
        text[] industry
        text[] specialties
        integer founded_year
        integer employee_count
        text headquarters
        varchar headquarters_country
        varchar category
        text linkedin_url
        text twitter_url
        timestamptz created_at
        timestamptz updated_at
    }

    locations {
        uuid id PK
        varchar city
        varchar state
        varchar country
        char country_code
        text full_location
    }

    jobs {
        uuid id PK
        varchar title
        varchar slug
        uuid company_id FK
        uuid location_id FK
        text description
        text responsibilities
        text requirements
        varchar job_type
        varchar commitment_type
        varchar category
        varchar experience_level
        numeric salary_min
        numeric salary_max
        varchar salary_currency
        varchar salary_period
        boolean equity_offered
        text application_url
        varchar external_id
        varchar ats_provider
        varchar source_type
        boolean is_active
        timestamptz posted_date
        timestamptz scraped_at
        timestamptz updated_at
        integer view_count
        integer click_count
        jsonb raw_data
    }

    skills {
        uuid id PK
        varchar name
        varchar normalized_name
        varchar category
    }

    job_skills {
        uuid job_id FK
        uuid skill_id FK
        boolean is_required
    }

    job_history {
        uuid id PK
        uuid company_id FK
        text application_url
        varchar external_id
        varchar title
        text location_raw
        timestamptz first_seen_at
        timestamptz last_seen_at
        integer seen_count
        boolean is_in_main_db
        text fingerprint_method
    }

    companies ||--o{ jobs : "has"
    companies ||--o{ job_history : "tracks"
    locations ||--o{ jobs : "at"
    jobs ||--o{ job_skills : "requires"
    skills ||--o{ job_skills : "tagged in"
```

---

## 2. Duplicate Check Flow

```mermaid
flowchart TD
    A([Scraper runs for Company X]) --> B[Fetch job list\nfrom API / Sitemap / CSS]
    B --> C[Loop: for each job in list]

    C --> D{Build fingerprint}
    D --> D1{application_url\navailable?}
    D1 -- Yes --> FP1[Fingerprint =\napplication_url cleaned]
    D1 -- No --> D2{ATS job ID\nin URL?}
    D2 -- Yes --> FP2[Fingerprint =\ncompany_id + external_id]
    D2 -- No --> FP3[Fingerprint =\ncompany_id + title + location]

    FP1 --> E{Check job_history\nDoes fingerprint exist?}
    FP2 --> E
    FP3 --> E

    E -- FOUND duplicate --> F[Update last_seen_at\nIncrement seen_count]
    F --> G([Skip — do NOT insert again])

    E -- NOT FOUND new job --> H[Insert into job_history\nfirst_seen_at = now]

    H --> I{Does source\nprovide posted_date?}
    I -- Yes --> J[posted_date = source date]
    I -- No --> K[posted_date = first_seen_at\nproxy date]

    J --> L[Insert into main jobs table]
    K --> L
    L --> M([Done — job live in main DB])

    C -- All jobs processed --> N([Scrape run complete])
```

---

## 3. Full Data Pipeline Flow

```mermaid
flowchart LR
    subgraph SOURCES["Data Sources"]
        S1[ATS API\nGreenhouse / Lever\nWorkday / iCIMS]
        S2[Sitemap\nJobs XML]
        S3[CSS Scraper\nCareer Page HTML]
    end

    subgraph SCRAPING_DB["Scraping Config DB\n(separate — stays messy)"]
        SC[career_pages\nAPI endpoints\nCSS selectors\nPagination config]
    end

    subgraph PROCESSOR["Job Processor"]
        P1[Normalize fields\ntitle, location, salary etc.]
        P2[Duplicate Checker\nvs job_history]
        P3[Skill Extractor\nmap to skills table]
    end

    subgraph MAIN_DB["Main DB\n(clean production)"]
        M1[(companies)]
        M2[(locations)]
        M3[(jobs)]
        M4[(skills)]
        M5[(job_skills)]
        M6[(job_history\npermanent log)]
        V1[active_jobs_view]
    end

    subgraph FRONTEND["Job Board Frontend"]
        F1[Homepage\nrecent jobs]
        F2[Search\nfilter jobs]
        F3[Company page]
        F4[Job detail\napply button]
    end

    SC --> S1
    SC --> S2
    SC --> S3

    S1 --> P1
    S2 --> P1
    S3 --> P1

    P1 --> P2
    P2 --> P3
    P2 --> M6
    P3 --> M3
    P3 --> M4
    P3 --> M5
    M3 --> M2
    M3 --> M1

    M1 --> V1
    M2 --> V1
    M3 --> V1
    M4 --> V1
    M5 --> V1

    V1 --> F1
    V1 --> F2
    M1 --> F3
    M3 --> F4
```

---

## 4. Posted Date Logic

```mermaid
flowchart TD
    A[New job arrives] --> B{posted_date\nin source?}
    B -- Yes --> C[Use source posted_date\nSort by this]
    B -- No --> D{Seen this job\nbefore in job_history?}
    D -- Yes first_seen exists --> E[posted_date = first_seen_at\nfrom job_history]
    D -- No brand new --> F[posted_date = scraped_at now\nFirst time we see it]
    C --> G[Store in jobs.posted_date]
    E --> G
    F --> G
    G --> H[Frontend shows:\n1 day ago / 2 days ago etc.]
    G --> I[Filter: within 1 day\n1 week / 2 weeks\n1 month / 3 months]
```

---

## 5. job_history Table — Why It Exists

| Problem | How job_history solves it |
|---|---|
| Company re-posts same job | `fingerprint` match → skip insert |
| No posted_date from source | `first_seen_at` = proxy date |
| Scraper runs every day | `last_seen_at` updates, no duplicate rows |
| Want to know job age | `now() - first_seen_at` = approximate age |
| Track scraping reliability | `seen_count` shows how many times a job appeared |
| Company removes job | `last_seen_at` stops updating → can detect stale jobs later |

**This table is never deleted from.** It's a permanent audit log.
Every company's entire job history lives here for cross-checking.
