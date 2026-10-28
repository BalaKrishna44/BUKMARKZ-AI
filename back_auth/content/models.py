from django.db import models


class Video(models.Model):
    title = models.CharField(max_length=100)
    description = models.CharField(max_length=220)
    url = models.URLField(blank=False, null=False)

    def __str__(self):
        return self.title
