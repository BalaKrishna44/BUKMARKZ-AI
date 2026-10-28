from django.db import migrations, models


def scrub_card_data(apps, schema_editor):
    """Overwrite before the columns are dropped (next migration), so the values do not linger in reusable table pages."""
    Withdraw = apps.get_model('subscription', 'Withdraw')
    Withdraw.objects.update(card_number=0, cvc=0)
    for pk, email in Withdraw.objects.values_list('pk', 'user__email').iterator():
        Withdraw.objects.filter(pk=pk).update(payout_email=email or '')


class Migration(migrations.Migration):
    dependencies = [('subscription', '0011_auto_20210219_1453')]

    operations = [
        migrations.AddField('withdraw', 'payout_email', models.EmailField(max_length=254, default='')),
        # requests that already exist were handled under the old process
        migrations.AddField('withdraw', 'status', models.CharField(max_length=10, default='paid', choices=[('pending', 'Pending'), ('paid', 'Paid'), ('rejected', 'Rejected')])),
        migrations.RunPython(scrub_card_data, migrations.RunPython.noop),
    ]
