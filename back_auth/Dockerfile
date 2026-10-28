FROM python:3.12-slim

WORKDIR /usr/src/app

ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

RUN apt-get update \
    && apt-get install netcat -y
RUN apt-get upgrade -y && apt-get install postgresql gcc python3-dev musl-dev -y
RUN pip install --upgrade pip

COPY ./requirements.txt .
RUN pip install -r requirements.txt

COPY ./entrypoint.sh .

COPY . .
#RUN chmod +x /usr/src/app/entrypoint.sh

ENTRYPOINT ["/usr/src/app/entrypoint.sh"]


#FROM python:3.8
#
#ENV PYTHONDONTWRITEVYTECODE 1
#ENV PYTHONUNBUFFERED 1
#
#WORKDIR /usr/src/bukmarkz_backend
#
#COPY ./requirements.txt /usr/src/requirements.txt
#RUN pip install -r /usr/src/requirements.txt
#
#COPY . /usr/src/bukmarkz_backend
#
#EXPOSE 8000

