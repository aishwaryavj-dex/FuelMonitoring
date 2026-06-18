import sys
import os
# Ensure the project root is in the path
sys.path.append(os.path.dirname(os.path.abspath(__file__)) + os.sep + '..')

# Import the Flask app defined in app.py
from app import app, socketio

# Export the WSGI application for Vercel
application = app
