
import os
from supabase import create_client, Client

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
   
    pass

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError(
        "Missing SUPABASE_URL / SUPABASE_KEY environment variables. "
        "Copy .env.example to .env and fill in your Supabase project credentials."
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
