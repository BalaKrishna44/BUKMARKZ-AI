import imaplib
import email
from django.conf import settings
import re
from bs4 import BeautifulSoup
from .models import EmailBookmark
from django.contrib.auth import get_user_model
from .models import Category, Bookmark

host = 'imap.gmail.com'
username = settings.EMAIL_ADDRESS
password = settings.EMAIL_PASSWORD


def get_new_user_emails(user):
    all_emails = get_inbox()
    new_emails = []
    for mail in all_emails:
        address = mail['from']
        email_address = re.search("<(.*?)>", address).group(1)
        if get_user_model().objects.get(email=email_address).exists:
            new_emails += mail

    return new_emails


def add_email_bookmarks_to_dashboard(emails, user):
    for mail in emails:
        bookmark_data = _extract_bookmark_from_email(mail)
        bookmark_data['user'] = user
        try:
            bookmark = _create_email_bookmark(bookmark_data)
        except:
            continue


def get_inbox():
    try:
        mail = imaplib.IMAP4_SSL(host)
        mail.login(username, password)
        mail.select("inbox")
        _, search_data = mail.search(None, 'UNSEEN')
    except:
        return []
    my_message = []
    for num in search_data[0].split():
        email_data = {}
        _, data = mail.fetch(num, '(RFC822)')
        # print(data[0])
        _, b = data[0]
        email_message = email.message_from_bytes(b)
        for header in ['subject', 'to', 'from', 'date']:
            # print("{}: {}".format(header, email_message[header]))
            email_data[header] = email_message[header]
        for part in email_message.walk():
            if part.get_content_type() == "text/plain":
                body = part.get_payload(decode=True)
                try:
                    email_data['body'] = body.decode(encoding='UTF-8', errors='strict')
                except:
                    print('Decode Error')

            elif part.get_content_type() == "text/html":
                html_body = part.get_payload(decode=True)
                email_data['html_body'] = html_body.decode()
        my_message.append(email_data)

    return my_message


def _create_email_bookmark(bookmark_data):
    return EmailBookmark.objects.create(
        user=bookmark_data['user'],
        title=bookmark_data['title'],
        url=bookmark_data['url'],
        description="",
    )


def _extract_bookmark_from_email(mail):
    soup = BeautifulSoup(mail['html_body'], 'html.parser')
    link = soup.find('a')
    url = link.attrs['href']
    title = mail['subject'][:200]
    return {
        'title': title,
        'url': url,
    }


def create_bookmarks_category(user, title):
    return Category.objects.create(
        user=user,
        title=title,
        color='#0dca0d',
    )


def create_bookmark(category, name, url, description):
    return Bookmark.objects.create(
        category=category,
        name=name,
        url=url,
        description=description,
    )


def get_category_by_id(pk):
    return Category.objects.get(id=pk)
