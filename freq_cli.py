"""
CLI tool to find whet allocations are defined for specific radio frequencies
frequencies are in HZ
Data is downloaded using a Swagger api defined at https://opendata.traficom.fi/swagger/ui/index#/Taajuusjakotaulukko
Endpoint: https://opendata.traficom.fi/api/v8/Taajuusjakotaulukko
@odata.context: https://opendata.traficom.fi/OpenData/api/v8/$metadata#Taajuusjakotaulukko
"""

import json
import sys
import requests
import os

def get_allocations_with_bandwidth(center_freq, bandwidth):
    """
    Get allocations around a specific frequency with a specific bandwidth
    :param center_freq: Frequency in HZ
    :param bandwidth: Bandwidth in HZ
    :return: List of allocations
    Example: center_freq = 433 MHz, bandwidth = 1 MHz
    output all allocations that are in the range of 432 MHz - 434 MHz
    """
    with open('allocations.json') as f:
        data = json.load(f)
    freq_low = int(center_freq - bandwidth / 2)
    if freq_low < 0:
        freq_low = 0
    freq_high = int(center_freq + bandwidth / 2)
    allocations = []
    range2 = range(int(freq_low), int(freq_high))
    h_count = 0
    for allocation in data['value']:
        if allocation['Sub_band_lower_limit__Hz_'] in range2 or allocation['Sub_band_upper_limit__Hz_'] in range2:
            allocations.append(allocation)
        #range1 = range(allocation['Sub_band_lower_limit__Hz_'], allocation['Sub_band_upper_limit__Hz_'])
        if allocation['Sub_band_lower_limit__Hz_'] > freq_high:
            h_count += 1
            if h_count > 10:
                break
        #if len(set(range2).intersection(range1)) > 0:
            #allocations.append(allocation['Sub_band_usage'])
    return allocations, freq_low, freq_high


def get_entries_between_frequencies(freq_low, freq_high):
    """
    Get allocations between two frequencies
    :param freq_low: Low frequency
    :param freq_high: High frequency
    :return: List of allocations
    """
    with open('allocations.json') as f:
        data = json.load(f)
    allocations = data['value']
    entries = []
    for allocation in allocations:
        if allocation['Sub_band_lower_limit__Hz_'] in range(freq_low, freq_high) or allocation['Sub_band_upper_limit__Hz_'] in range(freq_low, freq_high):
            entries.append(allocation)
    return entries

def get_entries_where_value_greater_than(allocations, freq_low):
    """
    allocations = [{'Sub_band_lower_limit__Hz_': 1000, 'Sub_band_upper_limit__Hz_': 2000, 'Sub_band_usage': 'Amateur radio'}, {'Sub_band_lower_limit__Hz_': 1500, 'Sub_band_upper_limit__Hz_': 2000, 'Sub_band_usage': 'B'}, {'Sub_band_lower_limit__Hz_': 2000, 'Sub_band_upper_limit__Hz_': 2500, 'Sub_band_usage': 'C'}, {'Sub_band_lower_limit__Hz_': 1750, 'Sub_band_upper_limit__Hz_': 3000, 'Sub_band_usage': 'D'}]
    return keys where Sub_band_lower_limit__Hz_ > freq_low
    """
    d = allocations.items()


def search_by_fields(search_dict):
    """
    Input: {"upper-frequency":"455MHz", "lower-frequency":"432MHz", "filter":{"Priority":"Primary", "Sub_band_usage":"A"}}
    Output: [{'Sub_band_lower_limit__Hz_': 1000, 'Sub_band_upper_limit__Hz_': 2000, 'Sub_band_usage': 'A'}]
    """
    allocations = get_entries_between_frequencies(convert_freetext_frequency_to_hz(search_dict['lower_frequency']), convert_freetext_frequency_to_hz(search_dict['upper_frequency']))
    search_results = []
    filters=search_dict["filter"]
    for allocation in allocations:
        if all(allocation[key] == filters[key] for key in filters):
            search_results.append(allocation)
    return search_results


def search_by_field_value(field,value,data):
    """
    Search for a specific field value
    :param field: Field to search
    :param value: Value to search for
    :return: List of allocations
    """
    allocations = []
    if ',' in value:
        value = value.split(',')
    for allocation in data:
        print(type(allocation))
        if isinstance(value, list):
            for val in value:
                if allocation[field] == val:
                    allocations.append(allocation)
        else:
            if allocation[field] == value:
                allocations.append(allocation)
    return allocations

def find_unique_allocations():
    """
    Find allocations that dont overlap with any others in frequency
    """
    with open('allocations.json') as f:
        data = json.load(f)
    allocations = data['value']
    unique_allocations = []
    list_of_ranges = []
    for allocation in allocations:
        list_of_ranges.append((allocation['Sub_band_lower_limit__Hz_'], allocation['Sub_band_upper_limit__Hz_'], allocation['Direction'], allocation['Services_in_Finland']))
    
    for i in range(len(list_of_ranges)):
        for j in range(i+1, len(list_of_ranges)):
            if (list_of_ranges[i][0] < list_of_ranges[j][1] and list_of_ranges[i][1] > list_of_ranges[j][0]):
                if ((list_of_ranges[i][2] == "TX" and list_of_ranges[j][2] == "RX") or (list_of_ranges[i][2] == "RX" and list_of_ranges[j][2] == "TX")) and (list_of_ranges[i][3] == list_of_ranges[j][3]):
                    continue
                else:
                    break
        else:
            unique_allocations.append(allocations[i])
    return unique_allocations


def alloc_test(freq):
    with open('allocations.json') as f:
        data = json.load(f)
    allocs = (x for x in data['value'] if freq in range(x['Sub_band_lower_limit__Hz_'], x['Sub_band_upper_limit__Hz_']))
    return allocs


def get_allocations(freq):
    """
    Get allocations for a specific frequency
    :param freq: Frequency in HZ
    :return: List of allocations
    """
    with open('allocations.json') as f:
        data = json.load(f)
    allocations = []
    for allocation in data['value']:
        if freq >= allocation['Sub_band_lower_limit__Hz_'] and freq <= allocation['Sub_band_upper_limit__Hz_']:
            allocations.append(allocation['Sub_band_usage'])
    return allocations


def download_allocations(force_download=False):
    """
    Download the allocations from the Traficom API
    Skip if file exists and force_download is False
    :return: None
    """
    if force_download or not os.path.isfile('allocations.json'):
        url = 'https://opendata.traficom.fi/api/v8/Taajuusjakotaulukko'
        response = requests.get(url)
        if response.status_code == 200:
            data = response.json()
            with open('allocations.json', 'w') as f:
                json.dump(data, f)
            convert_frequency_band_to_hz()
        else:
            print('Error downloading data')

def convert_frequency_band_to_hz():
    data = json.load(open('allocations.json'))
    for allocation in data['value']:
        if "Services_in_Finland" in allocation:
            if allocation["Services_in_Finland"].isupper():
                allocation["Priority"] = "Primary"
                allocation["Primary"] = True
            else:
                allocation["Priority"] = "Secondary"
                allocation["Primary"] = False
        if 'Frequency_band_lower_limit' in allocation:
            freq_start = convert_freetext_frequency_to_hz(allocation['Frequency_band_lower_limit'])
            freq_end = convert_freetext_frequency_to_hz(allocation['Frequency_band_upper_limit'])
            allocation['Frequency_band_lower_limit_hz'] = freq_start
            allocation['Frequency_band_upper_limit_hz'] = freq_end
    with open('allocations.json', 'w') as f:
        json.dump(data, f)


# Convert freetext frequency to HZ
# "8.3 kHz" -> 8300, "9 kHz" -> 9000, "11.3 kHz" -> 11300
def convert_freetext_frequency_to_hz(freq: str):
    freq = freq.replace(' ', '')
    if freq.endswith('kHz'):
        freq = freq.replace('kHz', '')
        freq = int(float(freq) * 1000)
    elif freq.endswith('MHz'):
        freq = freq.replace('MHz', '')
        freq = int(float(freq) * 1000000)
    elif freq.endswith('GHz'):
        freq = freq.replace('GHz', '')
        freq = int(float(freq) * 1000000000)
    elif freq.endswith('Hz'):
        freq = freq.replace('Hz', '')
        freq = int(freq)
    return freq


def get_allocations_for_frequency(freq):
    """
    Get allocations for a specific frequency
    :param freq: Frequency in Hz
    :return: List of allocations
    """
    freq = convert_freetext_frequency_to_hz(freq)
    return get_allocations(freq)


