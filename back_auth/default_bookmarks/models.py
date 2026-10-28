from django.db import models


class DefaultCategory(models.Model):
    """Category on default dashboard"""
    title = models.CharField(max_length=30)
    color = models.CharField(max_length=10)

    class Meta:
        verbose_name_plural = "Categories"

    def __str__(self):
        return self.title


class DefaultBookmark(models.Model):
    """Bookmarks for default dashboard"""
    category = models.ForeignKey(
        DefaultCategory, related_name='bookmark', on_delete=models.CASCADE)
    name = models.CharField(max_length=30)
    url = models.URLField(default='', max_length=300)
    description = models.CharField(max_length=70, blank=True, null=True)

    def __str__(self):
        return self.name