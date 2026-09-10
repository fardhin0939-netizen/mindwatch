FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV MINDWATCH_DB_HOST=db \
    MINDWATCH_DB_USER=root \
    MINDWATCH_DB_PASSWORD=rootpassword \
    MINDWATCH_DB_NAME=mindwatch_db \
    MINDWATCH_SECRET_KEY=change-me-in-production

EXPOSE 5000

CMD ["gunicorn", "-b", "0.0.0.0:5000", "app:app"]
