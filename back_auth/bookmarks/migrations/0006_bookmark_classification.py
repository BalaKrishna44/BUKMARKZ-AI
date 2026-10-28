import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('bookmarks', '0005_bookmark_embedding'),
    ]

    operations = [
        migrations.AddField(
            model_name='bookmark',
            name='tags',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='bookmark',
            name='suggested_category',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                    related_name='+', to='bookmarks.category'),
        ),
        migrations.AddField(
            model_name='bookmark',
            name='suggested_category_title',
            field=models.CharField(blank=True, default='', max_length=30),
        ),
        migrations.AddField(
            model_name='bookmark',
            name='classification_confidence',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='bookmark',
            name='classified_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='bookmark',
            name='auto_moved',
            field=models.BooleanField(default=False),
        ),
    ]
