from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('accounts', '0004_magiclink_email_verified'),
    ]

    operations = [
        migrations.CreateModel(
            name='PasskeyChallenge',
            fields=[
                ('id', models.CharField(max_length=64, primary_key=True, serialize=False)),
                ('purpose', models.CharField(max_length=16)),
                ('challenge', models.CharField(max_length=64)),
                ('user_id', models.IntegerField(blank=True, null=True)),
                ('expires', models.DateTimeField(db_index=True)),
            ],
        ),
        migrations.CreateModel(
            name='PasskeyUserHandle',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('handle', models.CharField(max_length=64, unique=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='passkey_handle', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name='PasskeyCredential',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('credential_id', models.CharField(max_length=1400, unique=True)),
                ('public_key', models.BinaryField()),
                ('sign_count', models.PositiveBigIntegerField(default=0)),
                ('transports', models.JSONField(blank=True, default=list)),
                ('device_type', models.CharField(blank=True, max_length=16)),
                ('backed_up', models.BooleanField(default=False)),
                ('aaguid', models.CharField(blank=True, max_length=36)),
                ('label', models.CharField(max_length=64)),
                ('created', models.DateTimeField(auto_now_add=True)),
                ('last_used_at', models.DateTimeField(blank=True, null=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='passkeys', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created']},
        ),
    ]
