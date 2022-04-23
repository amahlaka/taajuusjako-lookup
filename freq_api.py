"""
Simple python webserver that returns the allocation of requested frequency
Endpoint: /api/freq/<freq> or /api/freq/<freq_str>  where <freq> is the frequency in Hz or <freq_str> is the frequency in kHz, MHz or GHz
"""
from requests import post
from freq_cli import get_allocations, download_allocations, convert_freetext_frequency_to_hz, get_allocations_with_bandwidth, find_unique_allocations, search_by_field_value, alloc_test, search_by_fields
from flask import Flask, request, jsonify, render_template, render_template_string
import uuid

ACCESS_TOKEN_LIST = ["TEST"]

def check_access_token(access_token):
    """
    Check if the access token is valid
    """
    if access_token in ACCESS_TOKEN_LIST:
        return True
    else:
        return False

app = Flask(__name__)

def createaccount():
    """
    Create a new account
    """
    account_id = str(uuid.uuid4())
    return account_id




@app.route('/api/freq/<freq>')
def get_allocations_for_frequency(freq):
    """
    Get allocations for a specific frequency
    :param freq: Frequency in HZ
    :return: List of allocations
    """
    freq = convert_freetext_frequency_to_hz(freq)
    allocations = get_allocations(freq)
    return jsonify(allocations)

@app.route('/api/freq/<freq>/<bandwidth>')
def get_allocations_for_frequency_with_bandwidth(freq, bandwidth):
    """
    Get allocations for a specific frequency
    :param freq: Frequency in HZ
    :return: List of allocations
    """
    freq = convert_freetext_frequency_to_hz(freq)
    bandwidth = convert_freetext_frequency_to_hz(bandwidth)
    allocations = get_allocations_with_bandwidth(freq, bandwidth)
    return jsonify(allocations)

@app.route('/frequency/<freq>')
def get_allocations_for_frequency_html(freq):
    """
    Get allocations for a specific frequency
    :param freq: Frequency in HZ
    :return: List of allocations
    """
    freq = convert_freetext_frequency_to_hz(freq)
    allocations = alloc_test(freq)
    return render_template('frequencies.html', freq=freq, allocations=allocations)

# Search endpoint with post and get support
@app.route('/search', methods=['GET', 'POST'])
def search():
    """
    Search for allocations
    example request body: {"Priority": "Primary", "Sub_band_usage": "Mobile"}
    :return: List of allocations
    """
    if request.method == 'POST':
        data = request.get_json()
        allocations = search_by_fields(data)
        return render_template('frequencies.html', allocations=allocations)
    else:
        return render_template('search.html')


@app.route(('/frequency/<freq>/<bandwidth>'), methods=['GET'])
def list_allocations(freq,bandwidth):
    """
    Render a HTML table of allocations for a specific frequency
    :param freq: Frequency in HZ
    :return: HTML table
    """
    freq = convert_freetext_frequency_to_hz(freq)
    bandwidth = convert_freetext_frequency_to_hz(bandwidth)
    allocations,freq_low,freq_high = get_allocations_with_bandwidth(freq, bandwidth)
    return render_template('frequencies.html', freq_low=freq_low, freq_high=freq_high, allocations=allocations)

@app.route('/unique-allocations')
def get_unique_allocations():
    """
    Get unique allocations
    :return: List of allocations
    """
    allocations = find_unique_allocations()
    return render_template('frequencies.html', title="Unique Allocations", allocations=allocations)

@app.route('/unique-allocations/<field>/<value>')
def filter_uniques(field: str, value: str):
    """
    Filter unique allocations
    :param field: Field to filter
    :param value: Value to filter
    :return: List of allocations
    """
    allocations = search_by_field_value(field, value.lower(), find_unique_allocations())
    return render_template('frequencies.html', title="Unique Allocations with Filters", allocations=allocations)

@app.route('/')
def index():
    """
    Index page
    """
    return render_template('index.html')

def main():
    """
    Main function
    """
    download_allocations()
    app.run(host='localhost', port=5000)


if __name__ == '__main__':
    main()
