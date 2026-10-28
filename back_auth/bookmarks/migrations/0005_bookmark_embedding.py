import pgvector.django
from django.db import migrations, models
from pgvector.django import VectorExtension


class Migration(migrations.Migration):
    """Enables pgvector and adds the embedding column + HNSW index.

    VectorExtension() runs `CREATE EXTENSION IF NOT EXISTS vector`, so it is safe to re-run.
    It must come BEFORE any operation that uses the vector type.
    The database role needs permission to create extensions (on managed Postgres, enable
    "vector" in the provider's dashboard first).
    """

    dependencies = [
        ('bookmarks', '0004_auto_20210216_1829'),
    ]

    operations = [
        VectorExtension(),
        migrations.AddField(
            model_name='bookmark',
            name='embedding',
            field=pgvector.django.VectorField(blank=True, dimensions=1536, null=True),
        ),
        migrations.AddField(
            model_name='bookmark',
            name='embedding_model',
            field=models.CharField(blank=True, default='', max_length=50),
        ),
        migrations.AddField(
            model_name='bookmark',
            name='embedded_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name='bookmark',
            index=pgvector.django.HnswIndex(
                ef_construction=64,
                fields=['embedding'],
                m=16,
                name='bookmark_embedding_hnsw',
                opclasses=['vector_cosine_ops'],
            ),
        ),
    ]
