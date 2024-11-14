FROM python:3.14.0a1-alpine
# set work directory
WORKDIR /usr/src/app

RUN pip install --upgrade pip
COPY ./requirements.txt .
RUN pip install -r requirements.txt

# copy project
COPY . .
RUN python -c "from freq_cli import download_allocations; download_allocations()"