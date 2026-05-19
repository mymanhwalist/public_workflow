import requests
from bs4 import BeautifulSoup
from supabase import create_client, Client

# Supabase setup
url = "https://bojsbsoqpnuzikyzpjlh.supabase.co"
key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvanNic29xcG51emlreXpwamxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxMTQ4NTIsImV4cCI6MjA2OTY5MDg1Mn0.-I2x1wJSHETB7E-r84V9tQLhdxRpa8xthx9DOTmr908"
supabase: Client = create_client(url, key)

def scrape_job(url):
    resp = requests.get(url)
    soup = BeautifulSoup(resp.text, 'html.parser')

    # Example: Find job info
    job_button = soup.find('button', class_='whitespace-nowrap')
    company_button = soup.find('button', class_='ml-4 whitespace-nowrap')

    # Parse job info (customize selectors as needed)
    role = job_button.find('h1').text.strip() if job_button else None
    # ...parse other fields similarly...

    # Parse company info
    company_name = company_button.find('h2').text.strip() if company_button else None
    # ...parse other fields similarly...

    # Insert or upsert company_info
    company_data = {
        "company_name": company_name,
        # ...other fields...
    }
    company_resp = supabase.table('company_info').upsert(company_data).execute()
    company_id = company_resp.data[0]['id']

    # Insert or upsert location
    location_data = {"location": "Chennai, India"}  # Example
    location_resp = supabase.table('location').upsert(location_data).execute()
    location_id = location_resp.data[0]['id']

    # Insert job
    job_data = {
        "role": role,
        "company_name": company_name,
        "company_info": company_id,
        "location": location_id,
        # ...other fields...
    }
    supabase.table('job').insert(job_data).execute()

# Example usage
scrape_job("https://hiring.cafe/job/c3VjY2Vzc2ZhY3RvcnNfX19ldV9fX3NlZWJ1cmdlcmFfX18xMTY5NDA4MzAx")