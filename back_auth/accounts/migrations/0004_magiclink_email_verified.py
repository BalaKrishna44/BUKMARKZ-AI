from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0003_auto_20210214_0937'),
    ]

    operations = [
        # Existing accounts are grandfathered as verified (default=True fills them in)...
        migrations.AddField(
            model_name='customuser',
            name='email_verified',
            field=models.BooleanField(default=True),
        ),
        # ...and from now on new password sign-ups start unverified.
        migrations.AlterField(
            model_name='customuser',
            name='email_verified',
            field=models.BooleanField(default=False),
        ),
        migrations.CreateModel(
            name='MagicLink',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('email', models.EmailField(db_index=True, max_length=254)),
                ('name', models.CharField(blank=True, max_length=150)),
                ('token_hash', models.CharField(max_length=64, unique=True)),
                ('allow_signup', models.BooleanField(default=False)),
                ('created', models.DateTimeField(auto_now_add=True)),
                ('expires', models.DateTimeField()),
                ('used_at', models.DateTimeField(blank=True, null=True)),
            ],
        ),
    ]
