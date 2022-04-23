// JavaScript code to handle the search form.
// Usage: User selects a field from a dropdown, then enters a value in the text field, Then adds it to the search filters.


// This function is called when the user selects a field from the dropdown.
// It adds the field to the search filters.
function add_field(field) {
    var field_name = field.value;
    var field_label = field.options[field.selectedIndex].text;
    var field_value = document.getElementById("field-value").value;
    if (field_value != '') {
        var field_id = field_name + '-' + field_value;
        var field_html = '<div id="' + field_id + '" class="search-field">' + field_label + ': ' + field_value + '<a href="javascript:remove_field(\'' + field_id + '\')">[x]</a></div>';
        document.getElementById('search-filters').innerHTML += field_html;
        document.getElementById(field_name).value = '';
    }
}

// This function is called when the user clicks the 'x' in the search filters.
// It removes the field from the search filters.
function remove_field(field_id) {
    document.getElementById(field_id).remove();
}

// This function is called when the user clicks the 'Search' button.
// It builds the search query and submits it to the server.
function submit_search() {
    var search_query = {};
    var filters = {};
    var lower_frequency = document.getElementById("lower-frequency").value;
    var upper_frequency = document.getElementById("upper-frequency").value;
    search_query['lower_frequency'] = lower_frequency;
    search_query['upper_frequency'] = upper_frequency;
    var search_filters = document.getElementById('search-filters').getElementsByTagName('div');
    for (var i = 0; i < search_filters.length; i++) {
        var field_name = search_filters[i].id.split('-')[0];
        var field_value = search_filters[i].id.split('-')[1];
        if (field_name != '' && field_value != '') {
            filters[field_name] = field_value;
        }
    }
    search_query['filter'] = filters;
    // make the request using POST
    var request = new XMLHttpRequest();
    request.open('POST', '/search', true);
    request.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
    request.send(JSON.stringify(search_query));
    request.onreadystatechange = function() {
        if (request.readyState == 4 && request.status == 200) {
            document.getElementById('search-results').innerHTML = request.responseText;
        }
    }
}