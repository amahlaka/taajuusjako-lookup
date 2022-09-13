# Taajuusjako-Lookup

A simple web-based application to quickly search the Finnish Radio frequency allocation table (Taajuusjako taulukko). 
I made this because scrolling thru a huge pdf to find allocation for specific frequncies is a PItA

Site: [taajuusjako.bololoo.com](https://taajuusjako.bololoo.com)

## Usage
simply Clone the repository and run `docker-compose up -d` to build the image  and start the server in production mode

## Development
To start the development server:
```
python3 -m venv .venv
source ./.venv/bin/activate
pip install -r requirements.txt
export FLASK_APP=freq_api.py
export FLASK_ENV=development
flask run
```
