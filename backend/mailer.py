"""
Shared SMTP mailer -- originally lived only inside alerts.py (Alert Rule
notification emails); extracted here so backend/auth.py's real invite flow
can send email too, without duplicating SMTP plumbing or reaching into
alerts.py's private functions.

SMTP_* env vars are optional (config.py leaves them unset by default) --
mail_configured() is checked before ever sending, so callers can always
attempt to send and simply get nothing (not an error) with no SMTP account
configured.
"""

import smtplib
from email.message import EmailMessage

import config


def mail_configured():
    return bool(config.SMTP_HOST and config.SMTP_USER and config.SMTP_PASSWORD and config.ALERT_EMAIL_FROM)


def send_email(to_addr, subject, body):
    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = config.ALERT_EMAIL_FROM
    msg['To'] = to_addr
    msg.set_content(body)
    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT) as server:
        server.starttls()
        server.login(config.SMTP_USER, config.SMTP_PASSWORD)
        server.send_message(msg)
