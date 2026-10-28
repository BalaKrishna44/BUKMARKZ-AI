from django.db import models
from django.utils import timezone
from django.conf import settings
from pgvector.django import VectorField, HnswIndex

# Must match the embedding model's output size (OpenAI text-embedding-3-small = 1536).
EMBEDDING_DIMENSIONS = 1536


class Category(models.Model):
    """Category of Bookmarks"""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='category')
    title = models.CharField(max_length=30)
    color = models.CharField(max_length=10, default="#000000")
    timestamp = models.DateTimeField(default=timezone.now)
    private = models.BooleanField(default=False, null=True, blank=True)

    def __str__(self):
        return "{}".format(self.title)

    class Meta:
        verbose_name_plural = "Categories"


class Bookmark(models.Model):
    """Bookmarks for personal dashboard.

    The owner is `category.user` (kept as-is so existing data and the React app keep working).
    `name` is the bookmark's title.
    """
    category = models.ForeignKey(
        Category, related_name='bookmark', on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    url = models.URLField(default='', max_length=300)
    description = models.CharField(max_length=70, blank=True, null=True)
    timestamp = models.DateTimeField(default=timezone.now)

    # --- AI semantic search ---
    # null until the embedding has been generated (OpenAI down, old rows, private categories).
    embedding = VectorField(dimensions=EMBEDDING_DIMENSIONS, null=True, blank=True)
    embedding_model = models.CharField(max_length=50, blank=True, default='')
    embedded_at = models.DateTimeField(null=True, blank=True)

    # --- AI auto-tagging and categorisation ---
    tags = models.JSONField(default=list, blank=True)              # e.g. ["python", "django"]
    suggested_category = models.ForeignKey(                        # "this looks like it belongs in..."
        'bookmarks.Category', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    suggested_category_title = models.CharField(max_length=30, blank=True, default='')   # a new category the AI proposes
    classification_confidence = models.FloatField(null=True, blank=True)
    classified_at = models.DateTimeField(null=True, blank=True)    # null = not classified yet
    auto_moved = models.BooleanField(default=False)                # the AI filed it (only if CLASSIFIER_AUTO_MOVE is on)

    def __str__(self):
        return "{} in {}".format(self.name, self.category)

    class Meta:
        indexes = [
            # Approximate nearest-neighbour index for cosine distance (needs pgvector >= 0.5).
            HnswIndex(
                name='bookmark_embedding_hnsw',
                fields=['embedding'],
                m=16,
                ef_construction=64,
                opclasses=['vector_cosine_ops'],
            ),
        ]


class Recommendation(models.Model):
    """Recommendation to user"""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='recommendation')
    title = models.CharField(max_length=200)
    url = models.URLField(default='', max_length=300)
    description = models.CharField(max_length=265, blank=True, null=True)
    added = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.title} for {self.user.username}'


class HelpUser(models.Model):
    """User information about what he searches"""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='helpuser')
    country = models.CharField(max_length=100, blank=True, null=True)
    zip = models.CharField(max_length=10)
    searching = models.CharField(max_length=265)
    price = models.DecimalField(max_digits=6, decimal_places=2)
    added = models.DateTimeField(auto_now_add=True)
    checked = models.BooleanField(default=False)

    def __str__(self):
        return self.searching


class EmailBookmark(models.Model):
    """Bookmarks send to email from phone/tablet"""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='emailbookmark')
    title = models.CharField(max_length=200)
    url = models.URLField(default='', max_length=300)
    description = models.CharField(max_length=265, blank=True, null=True)
    added = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.title} for {self.user.username}'
