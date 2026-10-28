from django.contrib import admin
from .models import Contact


class ContactAdmin(admin.ModelAdmin):
    list_display = ('email', 'name', 'subject', 'checked', 'timestamp')


admin.site.register(Contact, ContactAdmin)
