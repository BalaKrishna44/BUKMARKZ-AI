from django.db import migrations, models


class Migration(migrations.Migration):
    # Separate from 0012 on purpose: PostgreSQL refuses to ALTER a table in the same transaction that updated its rows.
    dependencies = [('subscription', '0012_withdraw_payout_email_scrub')]

    operations = [
        migrations.RemoveField('withdraw', 'card_number'),
        migrations.RemoveField('withdraw', 'expiry_date'),
        migrations.RemoveField('withdraw', 'cvc'),
        migrations.AlterField('withdraw', 'status', models.CharField(max_length=10, default='pending', choices=[('pending', 'Pending'), ('paid', 'Paid'), ('rejected', 'Rejected')])),
    ]
