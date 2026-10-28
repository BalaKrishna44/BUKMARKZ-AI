from django.db import models
from django.contrib.auth.models import User
from django.conf import settings


class Bookmark(models.Model):
    file = models.FileField(blank=True)
    author = models.ForeignKey(settings.AUTH_USER_MODEL,
                               on_delete=models.CASCADE)

    def __str__(self):
        return self.author
